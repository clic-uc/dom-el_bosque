'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowDown, ArrowUp, Loader2, Pencil, Plus, Trash2, TriangleAlert, Undo2, Upload } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useFieldArray, useForm, useWatch, type UseFormReturn } from 'react-hook-form';
import { z } from 'zod';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { isValidReason, ReasonField } from '@/components/shared/reason-field';
import { LayerIcon } from '@/components/shared/layer-icon';
import { EmptyState, ErrorState, LoadingState } from '@/components/shared/states';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { useActor, useCan } from '@/features/auth/actor-context';
import { HelpLink } from '@/features/help/HelpLink';
import { errorMessage, isReasonRequired } from '@/lib/api';
import { formatDateTime, formatInt } from '@/lib/format';
import { cn } from '@/lib/utils';
import {
  DEFAULT_LAYER_ICON,
  DEFAULT_LAYER_ICON_COLOR,
  departmentLabels,
  departments,
  fieldTypeDescriptions,
  fieldTypeLabels,
  fieldTypes,
  importStatusLabels,
  type Department,
  type FieldType,
} from '@/shared/constants';
import { autonumberOptionsSchema, createLayerSchema, type CreateLayerInput, type UpdateLayerInput } from '@/shared/schemas/layers';
import { normalizeText, toFieldKey, uniqueSuffix } from '@/shared/text';
import type { ImportItem, Layer, LayerWithCount } from '@/shared/types';
import { IconPicker } from './IconPicker';
import { UniqueKeysEditor } from './UniqueKeysEditor';
import {
  useConvertPreview,
  useCounters,
  useCreateLayer,
  useDeleteLayer,
  useLayerImports,
  useRevertImport,
  useSetNextNumber,
  useUpdateLayer,
} from './hooks';

/**
 * Diálogo de crear/editar capa (§10.2 "LayerFormDialog"). Contrato de props fijado en la fase 2.
 */
export type LayerFormDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: 'create' | 'edit';
  /** Requerido en modo `edit`. */
  layer?: LayerWithCount;
  /** Departamento preseleccionado en modo `create`. */
  defaultDepartment?: Department;
  onSaved?: (layer: Layer) => void;
  onDeleted?: (layerId: number) => void;
  /** "Importar registros" dentro del diálogo: el contenedor abre el ImportWizard. */
  onImport?: (layerId: number) => void;
};

// ---------- Esquema del formulario ----------

const fieldRowSchema = z.object({
  uid: z.string(),
  key: z.string(),
  label: z.string(),
  type: z.enum(fieldTypes),
  required: z.boolean(),
  options: z.record(z.string(), z.unknown()),
  /** Solo campos ya guardados en la capa (modo edición). */
  savedKey: z.string().optional(),
  savedType: z.enum(fieldTypes).optional(),
  /** El usuario pidió renombrar la clave interna (envía `renames`, §7.2). */
  renameKey: z.boolean(),
  /** El usuario revisó la vista previa de conversión y la confirmó (envía `convertTypes`, §7.2). */
  convertConfirmed: z.boolean(),
});
type FieldRow = z.infer<typeof fieldRowSchema>;

const formSchema = z
  .object({
    name: z.string(),
    department: z.string(),
    hasRole: z.boolean(),
    icon: z.string(),
    iconColor: z.string(),
    fields: z.array(fieldRowSchema),
    uniqueKeys: z.array(z.string()),
    addressFieldKey: z.string().nullable(),
    heatmapFieldKey: z.string().nullable(),
  })
  .superRefine((v, ctx) => {
    // La validación real es la de `createLayerSchema` (misma que aplica el servidor); se reportan sus mensajes por campo.
    const result = createLayerSchema.safeParse(toLayerInput(v));
    if (!result.success) {
      for (const issue of result.error.issues) {
        ctx.addIssue({ code: 'custom', path: issue.path as PropertyKey[], message: issue.message });
      }
    }
    v.fields.forEach((f, i) => {
      if (f.savedKey && f.savedType && f.type !== f.savedType && !f.convertConfirmed) {
        ctx.addIssue({
          code: 'custom',
          path: ['fields', i, 'type'],
          message: 'Revisa qué pasará con los valores guardados y confirma la conversión antes de guardar',
        });
      }
    });
  });
type FormValues = z.infer<typeof formSchema>;

function toLayerInput(v: FormValues): CreateLayerInput {
  return {
    name: v.name,
    department: v.department as Department,
    hasRole: v.hasRole,
    icon: v.icon,
    iconColor: v.iconColor,
    fields: v.fields.map((f) => ({ key: f.key, label: f.label, type: f.type, required: f.required, options: f.options })),
    uniqueKeys: v.uniqueKeys,
    addressFieldKey: v.addressFieldKey,
    heatmapFieldKey: v.heatmapFieldKey,
  };
}

function toUpdateInput(v: FormValues): UpdateLayerInput {
  return {
    ...toLayerInput(v),
    renames: v.fields
      .filter((f) => f.savedKey && f.renameKey && f.key !== f.savedKey)
      .map((f) => ({ from: f.savedKey!, to: f.key })),
    convertTypes: v.fields.filter((f) => f.savedKey && f.savedType && f.type !== f.savedType).map((f) => f.key),
  };
}

let uidCounter = 0;
const nextUid = () => `f${++uidCounter}`;

function initialValues(mode: 'create' | 'edit', layer?: LayerWithCount, defaultDepartment?: Department): FormValues {
  if (mode === 'edit' && layer) {
    return {
      name: layer.name,
      department: layer.department,
      hasRole: layer.hasRole,
      icon: layer.icon,
      iconColor: layer.iconColor,
      fields: layer.fields.map((f) => ({
        uid: nextUid(),
        key: f.key,
        label: f.label,
        type: f.type,
        required: f.required,
        options: f.options ?? {},
        savedKey: f.key,
        savedType: f.type,
        renameKey: false,
        convertConfirmed: false,
      })),
      uniqueKeys: layer.uniqueKeys,
      addressFieldKey: layer.addressFieldKey,
      heatmapFieldKey: layer.heatmapFieldKey,
    };
  }
  return {
    name: '',
    department: defaultDepartment ?? '',
    hasRole: true,
    icon: DEFAULT_LAYER_ICON,
    iconColor: DEFAULT_LAYER_ICON_COLOR,
    fields: [],
    uniqueKeys: [],
    addressFieldKey: null,
    heatmapFieldKey: null,
  };
}

const NONE = '__none__';
const fieldTypeOrder: FieldType[] = ['string', 'number', 'boolean', 'date', 'autonumber'];

// ---------- Componente principal ----------

export function LayerFormDialog(props: LayerFormDialogProps) {
  // El formulario se monta al abrir y se desmonta al cerrar: siempre parte desde la capa actual, sin efectos de reinicio.
  if (!props.open) return null;
  const stamp = props.layer ? `${props.layer.id}:${props.layer.updatedAt}` : 'new';
  return <LayerFormBody key={`${props.mode}:${stamp}`} {...props} />;
}

function LayerFormBody({
  open,
  onOpenChange,
  mode,
  layer,
  defaultDepartment,
  onSaved,
  onDeleted,
  onImport,
}: LayerFormDialogProps) {
  const isEdit = mode === 'edit' && !!layer;
  const recordCount = layer?.recordCount ?? 0;
  const can = useCan();

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: initialValues(mode, layer, defaultDepartment),
    mode: 'onSubmit',
    reValidateMode: 'onChange',
  });
  const { fields: rows, append, remove, move, update } = useFieldArray({ control: form.control, name: 'fields', keyName: 'rhfId' });
  const values = useWatch({ control: form.control });
  const watchedFields = useMemo(() => (values.fields ?? []) as FieldRow[], [values.fields]);

  const createMut = useCreateLayer();
  const updateMut = useUpdateLayer();
  const pending = createMut.isPending || updateMut.isPending;

  const [serverError, setServerError] = useState<string | null>(null);
  const [iconOpen, setIconOpen] = useState(false);
  const [pendingRemove, setPendingRemove] = useState<number | null>(null);
  /** Cambio que quita el correlativo de registros numerados: el servidor pidió el motivo (§8.8). */
  const [reasonPrompt, setReasonPrompt] = useState<{ values: FormValues; count: number } | null>(null);
  const [reason, setReason] = useState('');
  const numberedCount = layer?.numberedRecordCount ?? 0;
  const savedAutonumberKey = layer?.fields.find((f) => f.type === 'autonumber')?.key;

  // ---- helpers de campos ----
  function otherKeys(exceptIndex: number) {
    return watchedFields.filter((_, j) => j !== exceptIndex).map((r) => r.key);
  }

  /** Cambia la clave de un campo en todas las referencias (campos únicos, dirección, valor, campo de año). */
  function remapReferences(from: string, to: string) {
    if (from === to) return;
    const uk = form.getValues('uniqueKeys');
    if (uk.includes(from)) form.setValue('uniqueKeys', uk.map((k) => (k === from ? to : k)));
    if (form.getValues('addressFieldKey') === from) form.setValue('addressFieldKey', to);
    if (form.getValues('heatmapFieldKey') === from) form.setValue('heatmapFieldKey', to);
    watchedFields.forEach((r, j) => {
      if (r.type === 'autonumber' && r.options.yearFieldKey === from) {
        update(j, { ...r, options: { ...r.options, yearFieldKey: to } });
      }
    });
  }

  function dropReferences(key: string) {
    form.setValue('uniqueKeys', form.getValues('uniqueKeys').filter((k) => k !== key));
    if (form.getValues('addressFieldKey') === key) form.setValue('addressFieldKey', null);
    if (form.getValues('heatmapFieldKey') === key) form.setValue('heatmapFieldKey', null);
    watchedFields.forEach((r, j) => {
      if (r.type === 'autonumber' && r.options.yearFieldKey === key) {
        const { yearFieldKey: _drop, ...rest } = r.options;
        update(j, { ...r, options: rest });
      }
    });
  }

  function addField() {
    const label = '';
    append({
      uid: nextUid(),
      key: uniqueSuffix(toFieldKey(label), watchedFields.map((r) => r.key)),
      label,
      type: 'string',
      required: false,
      options: {},
      renameKey: false,
      convertConfirmed: false,
    });
  }

  function onLabelChange(i: number, label: string) {
    const row = watchedFields[i]!;
    const derive = !row.savedKey || row.renameKey;
    const key = derive ? uniqueSuffix(toFieldKey(label), otherKeys(i)) : row.key;
    update(i, { ...row, label, key });
    remapReferences(row.key, key);
  }

  function onRenameKeyChange(i: number, checked: boolean) {
    const row = watchedFields[i]!;
    const key = checked ? uniqueSuffix(toFieldKey(row.label), otherKeys(i)) : row.savedKey!;
    update(i, { ...row, renameKey: checked, key });
    remapReferences(row.key, key);
  }

  function onTypeChange(i: number, type: FieldType) {
    const row = watchedFields[i]!;
    const options = type === 'autonumber' ? { reset: 'never' } : {};
    update(i, { ...row, type, options, convertConfirmed: false });
    if (type !== 'string' && form.getValues('addressFieldKey') === row.key) form.setValue('addressFieldKey', null);
    if (type !== 'number' && form.getValues('heatmapFieldKey') === row.key) form.setValue('heatmapFieldKey', null);
  }

  function requestRemove(i: number) {
    const row = watchedFields[i]!;
    if (isEdit && row.savedKey && recordCount > 0) setPendingRemove(i);
    else doRemove(i);
  }

  function doRemove(i: number) {
    const row = watchedFields[i]!;
    remove(i);
    dropReferences(row.key);
    setPendingRemove(null);
  }

  async function onSubmit(v: FormValues, withReason?: string) {
    setServerError(null);
    try {
      const saved = isEdit
        ? await updateMut.mutateAsync({
            id: layer.id,
            patch: withReason ? { ...toUpdateInput(v), reason: withReason } : toUpdateInput(v),
          })
        : await createMut.mutateAsync(toLayerInput(v));
      setReasonPrompt(null);
      onSaved?.(saved);
      onOpenChange(false);
    } catch (err) {
      if (isReasonRequired(err)) {
        setReason('');
        setReasonPrompt({ values: v, count: err.details.count });
        return;
      }
      setReasonPrompt(null);
      setServerError(errorMessage(err));
    }
  }

  const stringFields = watchedFields.filter((f) => f.type === 'string' && f.label.trim());
  const numberFields = watchedFields.filter((f) => f.type === 'number' && f.label.trim());
  const fieldsError = form.formState.errors.fields?.message ?? form.formState.errors.fields?.root?.message;
  const hasRole = values.hasRole ?? true;
  const removingNumbered =
    pendingRemove !== null &&
    numberedCount > 0 &&
    !!savedAutonumberKey &&
    watchedFields[pendingRemove]?.savedKey === savedAutonumberKey;

  return (
    <Dialog open={open} onOpenChange={(o) => !pending && onOpenChange(o)}>
      <DialogContent className="flex max-h-[92vh] flex-col gap-0 p-0 sm:max-w-3xl">
        <DialogHeader className="border-b px-6 py-4 text-left">
          <DialogTitle className="text-xl">{isEdit ? `Editar capa «${layer.name}»` : 'Nueva capa'}</DialogTitle>
          <DialogDescription className="text-base">
            {isEdit
              ? `${formatInt(recordCount)} registro${recordCount === 1 ? '' : 's'} en esta capa. Los cambios en los campos se aplican a todos.`
              : 'Una capa agrupa registros del mismo tipo (por ejemplo, permisos de obra menor) con sus propios campos.'}
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit((v) => onSubmit(v))} noValidate className="flex min-h-0 flex-1 flex-col">
            <div className="min-h-0 flex-1 space-y-8 overflow-y-auto px-6 py-5">
              {/* ---------- Datos generales ---------- */}
              <section className="space-y-5">
                <SectionTitle title="Datos de la capa" help="capas/crear-y-editar" />
                <div className="grid gap-5 sm:grid-cols-2">
                  <FormField
                    control={form.control}
                    name="department"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-base">Departamento</FormLabel>
                        <Select value={field.value || undefined} onValueChange={field.onChange}>
                          <FormControl>
                            <SelectTrigger className="w-full text-base data-[size=default]:h-11">
                              <SelectValue placeholder="Elige un departamento" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {departments.map((d) => (
                              <SelectItem key={d} value={d} className="py-2.5 text-base">
                                {departmentLabels[d]}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="name"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-base">Nombre de la capa</FormLabel>
                        <FormControl>
                          <Input {...field} className="h-11 text-base" placeholder="Por ejemplo: Obras Menores" autoComplete="off" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <FormField
                  control={form.control}
                  name="hasRole"
                  render={({ field }) => (
                    <FormItem className="flex items-center justify-between gap-4 rounded-lg border p-4">
                      <div className="space-y-1">
                        <FormLabel className="text-base">Esta capa incluye Rol SII</FormLabel>
                        <FormDescription className="text-sm">
                          Cada registro se asocia a una propiedad del padrón y puede ubicarse con las coordenadas del rol.
                        </FormDescription>
                      </div>
                      <FormControl>
                        <Switch checked={field.value} onCheckedChange={field.onChange} className="scale-125" />
                      </FormControl>
                    </FormItem>
                  )}
                />

                <div className="flex items-center justify-between gap-4 rounded-lg border p-4">
                  <div className="flex items-center gap-4">
                    <div
                      className="flex size-12 shrink-0 items-center justify-center rounded-full border-[3px] bg-white"
                      style={{ borderColor: values.iconColor }}
                      aria-hidden
                    >
                      <LayerIcon name={values.icon} color={values.iconColor} className="size-7" />
                    </div>
                    <div>
                      <p className="text-base font-medium">Ícono y color</p>
                      <p className="text-sm text-muted-foreground">Así se verán los puntos de esta capa en el mapa.</p>
                    </div>
                  </div>
                  <Button type="button" variant="outline" className="h-11 text-base" onClick={() => setIconOpen(true)}>
                    <Pencil aria-hidden /> Editar ícono
                  </Button>
                </div>
                <IconPicker
                  open={iconOpen}
                  onOpenChange={setIconOpen}
                  icon={values.icon ?? DEFAULT_LAYER_ICON}
                  color={values.iconColor ?? DEFAULT_LAYER_ICON_COLOR}
                  onSave={(icon, color) => {
                    form.setValue('icon', icon, { shouldDirty: true });
                    form.setValue('iconColor', color, { shouldDirty: true });
                  }}
                />
              </section>

              {/* ---------- Campos ---------- */}
              <section className="space-y-4">
                <SectionTitle
                  title="Campos"
                  help="capas/campos"
                  description="Los datos que tendrá cada registro. El primero es el que se muestra al pasar el mouse sobre un punto."
                />
                {rows.length === 0 ? (
                  <EmptyState
                    title="Esta capa aún no tiene campos"
                    description="Agrega los datos que quieres guardar de cada registro, por ejemplo N° Permiso, Dirección o Fecha."
                    className="py-6"
                  />
                ) : (
                  <ol className="space-y-3">
                    {rows.map((row, i) => {
                      const current = watchedFields[i] ?? (row as FieldRow);
                      return (
                        <li key={row.rhfId}>
                          <FieldRowEditor
                            form={form}
                            index={i}
                            total={rows.length}
                            row={current}
                            allFields={watchedFields}
                            isEdit={isEdit}
                            layerId={layer?.id}
                            recordCount={recordCount}
                            canAdjustCounter={can('records.correctNumber')}
                            onLabelChange={(label) => onLabelChange(i, label)}
                            onTypeChange={(t) => onTypeChange(i, t)}
                            onRenameKeyChange={(c) => onRenameKeyChange(i, c)}
                            onRequiredChange={(c) => update(i, { ...current, required: c })}
                            onOptionsChange={(options) => update(i, { ...current, options })}
                            onConvertConfirmedChange={(c) => update(i, { ...current, convertConfirmed: c })}
                            onMove={(dir) => move(i, i + dir)}
                            onRemove={() => requestRemove(i)}
                          />
                        </li>
                      );
                    })}
                  </ol>
                )}
                {fieldsError ? (
                  <p className="text-sm font-medium text-destructive" role="alert">
                    {fieldsError}
                  </p>
                ) : null}
                <Button type="button" variant="outline" className="h-11 text-base" onClick={addField}>
                  <Plus aria-hidden /> Agregar campo
                </Button>
              </section>

              {/* ---------- Campos únicos ---------- */}
              <section className="space-y-4">
                <SectionTitle title="Campos únicos" />
                <UniqueKeysEditor
                  fields={watchedFields.map((f) => ({ key: f.key, label: f.label, type: f.type, options: f.options, savedKey: f.savedKey }))}
                  value={values.uniqueKeys ?? []}
                  onChange={(keys) => form.setValue('uniqueKeys', keys, { shouldDirty: true, shouldValidate: form.formState.isSubmitted })}
                  hasRole={hasRole}
                  layerId={isEdit ? layer.id : undefined}
                  error={form.formState.errors.uniqueKeys?.message}
                />
              </section>

              {/* ---------- Dirección y valor ---------- */}
              <section className="space-y-4">
                <SectionTitle title="Dirección y valor para mapas de calor" help="capas/direccion-y-valor" />
                <div className="grid gap-5 sm:grid-cols-2">
                  <FormField
                    control={form.control}
                    name="addressFieldKey"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-base">Campo de dirección</FormLabel>
                        <Select value={field.value ?? NONE} onValueChange={(v) => field.onChange(v === NONE ? null : v)}>
                          <FormControl>
                            <SelectTrigger className="w-full text-base data-[size=default]:h-11">
                              <SelectValue />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value={NONE} className="py-2.5 text-base">
                              Ninguno
                            </SelectItem>
                            {stringFields.map((f) => (
                              <SelectItem key={f.uid} value={f.key} className="py-2.5 text-base">
                                {f.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormDescription className="text-sm">
                          Campo de texto con la dirección, para ubicar en el mapa los registros sin rol ni coordenadas.
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="heatmapFieldKey"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-base">Valor para mapas de calor</FormLabel>
                        <Select value={field.value ?? NONE} onValueChange={(v) => field.onChange(v === NONE ? null : v)}>
                          <FormControl>
                            <SelectTrigger className="w-full text-base data-[size=default]:h-11">
                              <SelectValue />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value={NONE} className="py-2.5 text-base">
                              Ninguno
                            </SelectItem>
                            {numberFields.map((f) => (
                              <SelectItem key={f.uid} value={f.key} className="py-2.5 text-base">
                                {f.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormDescription className="text-sm">
                          Campo numérico (por ejemplo, monto de inversión) que se suma en el mapa de calor por valor.
                          {numberFields.length === 0 ? ' Agrega un campo de tipo Número para poder elegirlo.' : ''}
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              </section>

              {/* ---------- Solo edición: importaciones y eliminación ---------- */}
              {isEdit ? (
                <>
                  <section className="space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <SectionTitle title="Importaciones" help="importacion/revertir" />
                      {can('imports.write') && onImport ? (
                        <Button type="button" variant="outline" className="h-11 text-base" onClick={() => onImport(layer.id)}>
                          <Upload aria-hidden /> Importar registros
                        </Button>
                      ) : null}
                    </div>
                    <ImportHistory layerId={layer.id} />
                  </section>

                  <DeleteLayerSection
                    layer={layer}
                    onDeleted={(id) => {
                      onDeleted?.(id);
                      onOpenChange(false);
                    }}
                  />
                </>
              ) : null}
            </div>

            <DialogFooter className="flex-col gap-3 border-t px-6 py-4 sm:flex-row sm:items-center">
              {serverError ? (
                <p className="flex-1 text-sm font-medium text-destructive" role="alert">
                  {serverError}
                </p>
              ) : form.formState.isSubmitted && Object.keys(form.formState.errors).length > 0 ? (
                <p className="flex-1 text-sm font-medium text-destructive" role="alert">
                  Hay datos por corregir más arriba. Revisa los mensajes en rojo.
                </p>
              ) : (
                <span className="flex-1" />
              )}
              <Button type="button" variant="outline" className="h-11 text-base" onClick={() => onOpenChange(false)} disabled={pending}>
                Cancelar
              </Button>
              <Button type="submit" className="h-11 min-w-40 text-base" disabled={pending}>
                {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
                {isEdit ? 'Guardar cambios' : 'Crear capa'}
              </Button>
            </DialogFooter>
          </form>
        </Form>

        <ConfirmDialog
          open={pendingRemove !== null}
          onOpenChange={(o) => !o && setPendingRemove(null)}
          title={`¿Eliminar el campo «${pendingRemove !== null ? (watchedFields[pendingRemove]?.label ?? '') : ''}»?`}
          description={
            <div className="space-y-2">
              <p>
                Se eliminarán los valores de este campo en los {formatInt(recordCount)} registros de la capa al guardar
                los cambios. Esta acción no se puede deshacer.
              </p>
              {removingNumbered ? (
                <p className="text-amber-900">
                  Es el correlativo de la capa: {formatInt(numberedCount)}{' '}
                  {numberedCount === 1 ? 'registro perderá su número' : 'registros perderán su número'} asignado por la
                  plataforma.{' '}
                  {can('records.deleteNumbered')
                    ? 'Al guardar se te pedirá el motivo.'
                    : 'Solo un administrador puede hacerlo.'}
                </p>
              ) : null}
            </div>
          }
          confirmLabel="Eliminar campo"
          destructive
          disabled={removingNumbered && !can('records.deleteNumbered')}
          onConfirm={() => {
            if (pendingRemove !== null) doRemove(pendingRemove);
          }}
        />

        <ConfirmDialog
          open={reasonPrompt !== null}
          onOpenChange={(o) => !o && setReasonPrompt(null)}
          title="Indica el motivo del cambio"
          description={
            <p>
              Con este cambio, {formatInt(reasonPrompt?.count ?? 0)}{' '}
              {reasonPrompt?.count === 1 ? 'registro pierde su número' : 'registros pierden su número'} asignado por la
              plataforma. Los números quedan en el registro de auditoría y no se vuelven a usar.
            </p>
          }
          confirmLabel="Guardar cambios"
          destructive
          pending={pending}
          disabled={!isValidReason(reason)}
          onConfirm={() => {
            if (reasonPrompt) void onSubmit(reasonPrompt.values, reason.trim());
          }}
        >
          <ReasonField id="layer-change-reason" value={reason} onChange={setReason} placeholder="Por ejemplo: se reemplaza la numeración" />
        </ConfirmDialog>
      </DialogContent>
    </Dialog>
  );
}

// ---------- Subcomponentes ----------

function SectionTitle({ title, help, description }: { title: string; help?: Parameters<typeof HelpLink>[0]['slug']; description?: string }) {
  return (
    <div>
      <h3 className="flex items-center gap-1 text-lg font-semibold">
        {title}
        {help ? <HelpLink slug={help} /> : null}
      </h3>
      {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
    </div>
  );
}

type FieldRowEditorProps = {
  form: UseFormReturn<FormValues>;
  index: number;
  total: number;
  row: FieldRow;
  allFields: FieldRow[];
  isEdit: boolean;
  layerId?: number;
  recordCount: number;
  canAdjustCounter: boolean;
  onLabelChange: (label: string) => void;
  onTypeChange: (type: FieldType) => void;
  onRenameKeyChange: (checked: boolean) => void;
  onRequiredChange: (checked: boolean) => void;
  onOptionsChange: (options: Record<string, unknown>) => void;
  onConvertConfirmedChange: (checked: boolean) => void;
  onMove: (dir: -1 | 1) => void;
  onRemove: () => void;
};

function FieldRowEditor(p: FieldRowEditorProps) {
  const { form, index: i, total, row, allFields, isEdit, layerId, recordCount } = p;
  const isSaved = isEdit && !!row.savedKey;
  const derivedKey = uniqueSuffix(toFieldKey(row.label), allFields.filter((_, j) => j !== i).map((r) => r.key));
  const canRename = isSaved && derivedKey !== row.savedKey;
  const typeChanged = isSaved && row.savedType !== row.type;
  const autoOpts = row.type === 'autonumber' ? autonumberOptionsSchema.safeParse(row.options) : null;
  const reset = autoOpts?.success ? autoOpts.data.reset : 'never';
  const yearFieldKey = autoOpts?.success ? autoOpts.data.yearFieldKey : undefined;
  const yearCandidates = allFields.filter((f) => f.key !== row.key && f.type !== 'autonumber' && f.label.trim());

  return (
    <div className={cn('space-y-4 rounded-lg border p-4', typeChanged && 'border-amber-400')}>
      <div className="flex items-start gap-3">
        <span className="mt-3 w-6 shrink-0 text-center text-base font-semibold text-muted-foreground" aria-hidden>
          {i + 1}
        </span>
        <div className="grid flex-1 gap-4 sm:grid-cols-[1fr_230px]">
          <FormField
            control={form.control}
            name={`fields.${i}.label`}
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-base">Nombre del campo</FormLabel>
                <FormControl>
                  <Input
                    value={field.value}
                    onBlur={field.onBlur}
                    ref={field.ref}
                    name={field.name}
                    onChange={(e) => p.onLabelChange(e.target.value)}
                    className="h-11 text-base"
                    placeholder="Por ejemplo: N° Permiso"
                    autoComplete="off"
                  />
                </FormControl>
                <p className="text-xs text-muted-foreground">
                  Clave interna: <code className="rounded bg-muted px-1 py-0.5">{row.key}</code>
                </p>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name={`fields.${i}.type`}
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-base">Tipo de dato</FormLabel>
                <Select value={field.value} onValueChange={(v) => p.onTypeChange(v as FieldType)}>
                  <FormControl>
                    <SelectTrigger className="w-full text-base data-[size=default]:h-11">
                      <SelectValue />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {fieldTypeOrder.map((t) => (
                      <SelectItem key={t} value={t} className="py-2 text-base">
                        <div className="flex flex-col items-start">
                          <span>{fieldTypeLabels[t]}</span>
                          <span className="text-xs text-muted-foreground">{fieldTypeDescriptions[t]}</span>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
        <div className="flex shrink-0 flex-col gap-1 sm:flex-row">
          <Button type="button" variant="ghost" className="size-11" aria-label="Subir campo" disabled={i === 0} onClick={() => p.onMove(-1)}>
            <ArrowUp className="size-5" aria-hidden />
          </Button>
          <Button type="button" variant="ghost" className="size-11" aria-label="Bajar campo" disabled={i === total - 1} onClick={() => p.onMove(1)}>
            <ArrowDown className="size-5" aria-hidden />
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="size-11 text-destructive hover:bg-destructive/10 hover:text-destructive"
            aria-label="Eliminar campo"
            onClick={p.onRemove}
          >
            <Trash2 className="size-5" aria-hidden />
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 pl-9">
        <label className="flex min-h-11 cursor-pointer items-center gap-2 text-base">
          <Checkbox checked={row.required} onCheckedChange={(c) => p.onRequiredChange(c === true)} className="size-5" />
          Obligatorio
          <span className="text-sm text-muted-foreground">(cada registro debe tener este dato)</span>
        </label>
      </div>

      {canRename ? (
        <div className="ml-9 space-y-1 rounded-md bg-muted/60 p-3">
          <label className="flex min-h-11 cursor-pointer items-start gap-2 text-base">
            <Checkbox checked={row.renameKey} onCheckedChange={(c) => p.onRenameKeyChange(c === true)} className="mt-1 size-5" />
            <span>
              Cambiar también la clave interna de <code>{row.savedKey}</code> a <code>{derivedKey}</code>
              <span className="block text-sm text-muted-foreground">
                Normalmente no hace falta: puedes cambiar el nombre visible sin tocar la clave. Si la cambias, los valores de{' '}
                {formatInt(recordCount)} registros se moverán a la nueva clave.
              </span>
            </span>
          </label>
        </div>
      ) : null}

      {row.type === 'autonumber' ? (
        <div className="ml-9 space-y-3 rounded-md bg-muted/60 p-3">
          <div className="flex items-center gap-1 text-base font-medium">
            Correlativo <HelpLink slug="capas/correlativos" />
          </div>
          <p className="text-sm text-muted-foreground">
            El número no se escribe a mano: se asigna con la acción «Asignar número» cuando el permiso está aprobado.
          </p>
          <label className="flex min-h-11 items-center justify-between gap-4 text-base">
            <span>¿Reinicia cada año?</span>
            <Switch
              checked={reset === 'yearly'}
              onCheckedChange={(c) => p.onOptionsChange(c ? { reset: 'yearly', yearFieldKey } : { reset: 'never' })}
              className="scale-125"
            />
          </label>
          {reset === 'yearly' ? (
            <div className="space-y-1">
              <Label className="text-base" htmlFor={`year-field-${row.uid}`}>
                Campo donde se guarda el año
              </Label>
              <Select value={yearFieldKey ?? ''} onValueChange={(v) => p.onOptionsChange({ reset: 'yearly', yearFieldKey: v })}>
                <SelectTrigger id={`year-field-${row.uid}`} className="w-full text-base data-[size=default]:h-11">
                  <SelectValue placeholder="Elige el campo de año" />
                </SelectTrigger>
                <SelectContent>
                  {yearCandidates.length === 0 ? (
                    <div className="p-3 text-sm text-muted-foreground">Agrega primero un campo numérico «Año».</div>
                  ) : (
                    yearCandidates.map((f) => (
                      <SelectItem key={f.uid} value={f.key} className="py-2.5 text-base">
                        {f.label}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
              <p className="text-sm text-muted-foreground">
                Con reinicio anual, los campos únicos deberían ser el correlativo más el año.
              </p>
            </div>
          ) : null}
          {isSaved && row.savedType === 'autonumber' && layerId !== undefined ? (
            <CountersPanel layerId={layerId} reset={reset} canAdjust={p.canAdjustCounter} />
          ) : null}
        </div>
      ) : null}

      {typeChanged && layerId !== undefined && row.savedKey && row.savedType ? (
        <ConversionPreview
          layerId={layerId}
          savedKey={row.savedKey}
          fromType={row.savedType}
          toType={row.type}
          recordCount={recordCount}
          confirmed={row.convertConfirmed}
          onConfirmedChange={p.onConvertConfirmedChange}
        />
      ) : null}
    </div>
  );
}

function ConversionPreview({
  layerId,
  savedKey,
  fromType,
  toType,
  recordCount,
  confirmed,
  onConfirmedChange,
}: {
  layerId: number;
  savedKey: string;
  fromType: FieldType;
  toType: FieldType;
  recordCount: number;
  confirmed: boolean;
  onConfirmedChange: (c: boolean) => void;
}) {
  const preview = useConvertPreview(layerId, savedKey, toType, recordCount > 0);
  const total = preview.data ? preview.data.convertible + preview.data.notConvertible : 0;
  const noValues = recordCount === 0 || (preview.isSuccess && total === 0);
  const blocked = preview.isSuccess && toType === 'autonumber' && preview.data.notConvertible > 0;

  // Sin valores guardados no hay nada que convertir: no pedimos confirmación.
  useEffect(() => {
    if (noValues && !confirmed) onConfirmedChange(true);
  }, [noValues, confirmed, onConfirmedChange]);

  return (
    <div className="ml-9" aria-live="polite">
      {noValues ? (
        <p className="text-sm text-muted-foreground">
          Cambio de tipo de {fieldTypeLabels[fromType]} a {fieldTypeLabels[toType]}: no hay valores guardados en este campo, así que no
          afecta a ningún registro.
        </p>
      ) : preview.isPending ? (
        <Skeleton className="h-16 w-full" />
      ) : preview.isError ? (
        <p className="text-sm text-destructive">No se pudo calcular la vista previa: {errorMessage(preview.error)}</p>
      ) : blocked ? (
        <Alert variant="destructive">
          <TriangleAlert aria-hidden />
          <AlertTitle className="text-base">No se puede convertir en correlativo todavía</AlertTitle>
          <AlertDescription className="text-base">
            <p>
              Hay {formatInt(preview.data.notConvertible)} valor{preview.data.notConvertible === 1 ? '' : 'es'} que no{' '}
              {preview.data.notConvertible === 1 ? 'es un número entero' : 'son números enteros'}
              {preview.data.samples.length ? ` (por ejemplo: ${preview.data.samples.map(String).join(', ')})` : ''}. Corrige esos registros
              en la tabla o vuelve a dejar el tipo {fieldTypeLabels[fromType]}.
            </p>
          </AlertDescription>
        </Alert>
      ) : (
        <Alert>
          <TriangleAlert aria-hidden />
          <AlertTitle className="text-base">
            Cambio de tipo: {fieldTypeLabels[fromType]} → {fieldTypeLabels[toType]}
          </AlertTitle>
          <AlertDescription className="text-base">
            <p>
              Se convertirán {formatInt(preview.data.convertible)} valor{preview.data.convertible === 1 ? '' : 'es'}.
              {preview.data.notConvertible > 0
                ? ` ${formatInt(preview.data.notConvertible)} no se pueden convertir y quedarán guardados como texto${
                    preview.data.samples.length ? ` (por ejemplo: ${preview.data.samples.map(String).join(', ')})` : ''
                  }.`
                : ' Todos los valores se pueden convertir.'}
            </p>
            <label className="mt-2 flex min-h-11 cursor-pointer items-center gap-2 text-base font-medium">
              <Checkbox checked={confirmed} onCheckedChange={(c) => onConfirmedChange(c === true)} className="size-5" />
              Entiendo, convertir los valores al guardar
            </label>
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}

function CountersPanel({ layerId, reset, canAdjust }: { layerId: number; reset: 'never' | 'yearly'; canAdjust: boolean }) {
  const counters = useCounters(layerId);
  const setNext = useSetNextNumber(layerId);
  const [editing, setEditing] = useState<string | null>(null);
  const [next, setNextValue] = useState('');
  const [reason, setReason] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);

  if (counters.isPending) return <Skeleton className="h-10 w-full" />;
  if (counters.isError) {
    return <p className="text-sm text-destructive">No se pudo cargar el próximo número: {errorMessage(counters.error)}</p>;
  }
  if (counters.data.length === 0) return null;

  async function save(period: string) {
    setLocalError(null);
    const n = Number(next.replace(/\./g, ''));
    if (!Number.isInteger(n) || n <= 0) {
      setLocalError('Escribe un número entero mayor que cero.');
      return;
    }
    if (reason.trim().length < 3) {
      setLocalError('Escribe el motivo del ajuste (al menos 3 letras).');
      return;
    }
    try {
      await setNext.mutateAsync({ period, next: n, reason: reason.trim() });
      setEditing(null);
      setNextValue('');
      setReason('');
    } catch (err) {
      setLocalError(errorMessage(err));
    }
  }

  return (
    <div className="space-y-2 border-t pt-3">
      {counters.data.map((c) => (
        <div key={c.period} className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2 text-base">
            <span>
              {reset === 'yearly' ? `Año ${c.period || new Date().getFullYear()}: ` : ''}
              Próximo número: <strong>{formatInt(c.next)}</strong>
              {c.lastValue > 0 ? (
                <span className="text-sm text-muted-foreground"> (último entregado por la plataforma: {formatInt(c.lastValue)})</span>
              ) : null}
            </span>
            {canAdjust ? (
              <Button
                type="button"
                variant="outline"
                className="h-11 text-base"
                onClick={() => {
                  setEditing(editing === c.period ? null : c.period);
                  setNextValue(String(c.next));
                  setReason('');
                  setLocalError(null);
                }}
              >
                {editing === c.period ? 'Cerrar' : 'Ajustar próximo número'}
              </Button>
            ) : null}
          </div>
          {editing === c.period ? (
            <div className="space-y-3 rounded-md border bg-background p-3">
              <p className="text-sm text-muted-foreground">
                Úsalo solo si se entregaron números fuera de la plataforma. El nuevo número debe ser mayor que todos los que ya existen en la capa;
                el contador nunca baja.
              </p>
              <div className="grid gap-3 sm:grid-cols-[200px_1fr]">
                <div className="space-y-1">
                  <Label htmlFor={`next-${c.period}`} className="text-base">
                    Nuevo próximo número
                  </Label>
                  <Input id={`next-${c.period}`} inputMode="numeric" value={next} onChange={(e) => setNextValue(e.target.value)} className="h-11 text-base" />
                </div>
                <div className="space-y-1">
                  <Label htmlFor={`reason-${c.period}`} className="text-base">
                    Motivo
                  </Label>
                  <Textarea
                    id={`reason-${c.period}`}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    rows={2}
                    className="text-base"
                    placeholder="Por ejemplo: se entregaron los números 6.124 a 6.130 en Excel"
                  />
                </div>
              </div>
              {localError ? (
                <p className="text-sm font-medium text-destructive" role="alert">
                  {localError}
                </p>
              ) : null}
              <Button type="button" className="h-11 text-base" disabled={setNext.isPending} onClick={() => save(c.period)}>
                {setNext.isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
                Guardar nuevo número
              </Button>
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function statusVariant(status: ImportItem['status']): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (status === 'COMPLETED') return 'default';
  if (status === 'FAILED') return 'destructive';
  if (status === 'REVERTED' || status === 'DISCARDED') return 'outline';
  return 'secondary';
}

function ImportHistory({ layerId }: { layerId: number }) {
  const actor = useActor();
  const can = useCan();
  const imports = useLayerImports(layerId);
  const revert = useRevertImport(layerId);
  const [toRevert, setToRevert] = useState<ImportItem | null>(null);

  if (imports.isPending) return <LoadingState rows={2} label="Cargando importaciones…" />;
  if (imports.isError) {
    return (
      <ErrorState
        title="No se pudo cargar el historial de importaciones"
        message={errorMessage(imports.error)}
        onRetry={() => imports.refetch()}
        className="py-6"
      />
    );
  }
  if (imports.data.data.length === 0) {
    return (
      <EmptyState
        title="Esta capa no tiene importaciones"
        description="Cuando subas una planilla con «Importar registros», aparecerá aquí y podrás revertirla si hace falta."
        className="py-6"
      />
    );
  }

  return (
    <>
      <ul className="divide-y rounded-md border">
        {imports.data.data.map((imp) => {
          const canRevert = imp.status === 'COMPLETED' && (can('imports.revertAll') || imp.userId === actor.id);
          return (
            <li key={imp.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="truncate text-base font-medium">{imp.fileName}</span>
                  <Badge variant={statusVariant(imp.status)}>{importStatusLabels[imp.status]}</Badge>
                </div>
                <p className="text-sm text-muted-foreground">
                  Creados {formatInt(imp.createdCount)} · Actualizados {formatInt(imp.updatedCount)} · Omitidos{' '}
                  {formatInt(imp.skippedCount)} · Fallidos {formatInt(imp.failedCount)}
                  {imp.deletedCount > 0 ? ` · Eliminados ${formatInt(imp.deletedCount)}` : ''}
                </p>
                <p className="text-sm text-muted-foreground">
                  {formatDateTime(imp.committedAt ?? imp.createdAt)}
                  {imp.userEmail ? ` · ${imp.userEmail}` : ''}
                </p>
              </div>
              {canRevert ? (
                <Button type="button" variant="outline" className="h-11 text-base" onClick={() => setToRevert(imp)}>
                  <Undo2 aria-hidden /> Revertir importación
                </Button>
              ) : null}
            </li>
          );
        })}
      </ul>
      {imports.data.total > imports.data.data.length ? (
        <p className="text-sm text-muted-foreground">
          Mostrando las {imports.data.data.length} importaciones más recientes de {imports.data.total}.
        </p>
      ) : null}
      <ConfirmDialog
        open={toRevert !== null}
        onOpenChange={(o) => !o && setToRevert(null)}
        title={`¿Revertir la importación «${toRevert?.fileName ?? ''}»?`}
        description={
          toRevert ? (
            <p>
              Se eliminarán los {formatInt(toRevert.createdCount)} registros que creó y se restaurarán los{' '}
              {formatInt(toRevert.updatedCount)} que actualizó
              {toRevert.deletedCount > 0 ? ` y se recuperarán los ${formatInt(toRevert.deletedCount)} que eliminó` : ''}. Si esos registros
              se editaron después de la importación, esos cambios se perderán.
            </p>
          ) : null
        }
        confirmLabel="Revertir importación"
        destructive
        pending={revert.isPending}
        onConfirm={async () => {
          if (!toRevert) return;
          try {
            await revert.mutateAsync(toRevert.id);
            setToRevert(null);
          } catch {
            // el toast del hook ya informó el error
          }
        }}
      />
    </>
  );
}

function DeleteLayerSection({ layer, onDeleted }: { layer: LayerWithCount; onDeleted: (id: number) => void }) {
  const del = useDeleteLayer();
  const can = useCan();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const [reason, setReason] = useState('');
  // La lista de capas puede venir con el conteo viejo: si el servidor pide el motivo, se pide igual.
  const [serverCount, setServerCount] = useState<number | null>(null);
  const numbered = serverCount ?? layer.numberedRecordCount;
  const canDeleteNumbered = can('records.deleteNumbered');
  const needsReason = numbered > 0;
  const needsName = layer.recordCount > 0;
  const nameMatches = normalizeText(typed) === normalizeText(layer.name);
  const numberedText = `${formatInt(numbered)} ${numbered === 1 ? 'registro tiene' : 'registros tienen'} un número asignado por la plataforma`;

  if (numbered > 0 && !canDeleteNumbered) {
    return (
      <section className="space-y-3 rounded-lg border border-destructive/40 p-4">
        <h3 className="text-lg font-semibold text-destructive">Eliminar capa</h3>
        <p className="text-base text-muted-foreground">
          {numberedText}. Solo un administrador puede eliminar esta capa.
        </p>
      </section>
    );
  }

  return (
    <section className="space-y-3 rounded-lg border border-destructive/40 p-4">
      <h3 className="text-lg font-semibold text-destructive">Eliminar capa</h3>
      <p className="text-base text-muted-foreground">
        {needsName
          ? `Se eliminarán la capa, sus ${formatInt(layer.recordCount)} registros, sus adjuntos y su historial de importaciones. No se puede deshacer.`
          : 'La capa no tiene registros. Se eliminará junto con su configuración. No se puede deshacer.'}
      </p>
      <Button type="button" variant="destructive" className="h-11 text-base" onClick={() => setOpen(true)}>
        <Trash2 aria-hidden /> Eliminar capa
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (!o) {
            setTyped('');
            setReason('');
          }
        }}
        title={`¿Eliminar la capa «${layer.name}»?`}
        description={
          <p>
            {needsName
              ? `Se eliminarán definitivamente sus ${formatInt(layer.recordCount)} registros con sus adjuntos y comentarios, además del historial de importaciones de la capa.`
              : 'La capa se eliminará definitivamente.'}{' '}
            Esta acción no se puede deshacer.
            {needsReason ? ` ${numberedText}; esos números no se vuelven a usar y quedan en el registro de auditoría.` : null}
          </p>
        }
        confirmLabel="Eliminar capa"
        destructive
        pending={del.isPending}
        disabled={(needsName && !nameMatches) || (needsReason && !isValidReason(reason))}
        onConfirm={async () => {
          try {
            await del.mutateAsync({ id: layer.id, reason: needsReason ? reason.trim() : undefined });
            setOpen(false);
            onDeleted(layer.id);
          } catch (err) {
            if (isReasonRequired(err)) setServerCount(err.details.count);
            // los demás errores ya los informó el toast del hook
          }
        }}
      >
        {needsReason ? <ReasonField id="delete-layer-reason" value={reason} onChange={setReason} /> : null}
        {needsName ? (
          <div className="space-y-2">
            <Label htmlFor="delete-layer-name" className="text-base">
              Para confirmar, escribe el nombre de la capa: <strong>{layer.name}</strong>
            </Label>
            <Input
              id="delete-layer-name"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              className="h-11 text-base"
              autoComplete="off"
              aria-invalid={typed.length > 0 && !nameMatches}
            />
          </div>
        ) : null}
      </ConfirmDialog>
    </section>
  );
}
