import { z } from 'zod';
import {
  DEFAULT_LAYER_ICON,
  DEFAULT_LAYER_ICON_COLOR,
  departments,
  fieldTypes,
  MAX_LAYER_FIELDS,
  RESERVED_FIELD_KEYS,
} from '../constants';

export const fieldKeySchema = z
  .string()
  .min(1, 'La clave no puede estar vacía')
  .max(80)
  .regex(/^[a-z][a-z0-9_]*$/, 'La clave debe ser minúsculas, números y guion bajo, y empezar con letra');

export const autonumberOptionsSchema = z.object({
  reset: z.enum(['never', 'yearly']).default('never'),
  yearFieldKey: z.string().optional(),
});
export type AutonumberOptions = z.infer<typeof autonumberOptionsSchema>;

export const layerFieldSchema = z.object({
  key: fieldKeySchema,
  label: z.string().trim().min(1, 'Escribe el nombre del campo').max(120),
  type: z.enum(fieldTypes).default('string'),
  required: z.boolean().default(false),
  options: z.record(z.string(), z.unknown()).default({}),
});
export type LayerField = z.infer<typeof layerFieldSchema>;
export type LayerFieldInput = z.input<typeof layerFieldSchema>;

export const layerFieldsSchema = z
  .array(layerFieldSchema)
  .max(MAX_LAYER_FIELDS, `Una capa puede tener hasta ${MAX_LAYER_FIELDS} campos`)
  .refine((fs) => new Set(fs.map((f) => f.key)).size === fs.length, 'Hay dos campos con la misma clave')
  .refine(
    (fs) => fs.filter((f) => f.type === 'autonumber').length <= 1,
    'Solo puede haber un correlativo por capa',
  )
  .refine(
    (fs) => !fs.some((f) => (RESERVED_FIELD_KEYS as readonly string[]).includes(f.key)),
    `Clave reservada (${RESERVED_FIELD_KEYS.join(', ')})`,
  )
  .refine((fs) => {
    const auto = fs.find((f) => f.type === 'autonumber');
    if (!auto) return true;
    const opts = autonumberOptionsSchema.safeParse(auto.options);
    if (!opts.success) return false;
    if (opts.data.reset === 'yearly') {
      if (!opts.data.yearFieldKey) return false;
      const yearField = fs.find((f) => f.key === opts.data.yearFieldKey);
      return !!yearField && yearField.type !== 'autonumber';
    }
    return true;
  }, 'Un correlativo que reinicia cada año necesita un campo de año válido');

const hexColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Color inválido');

const layerBaseShape = {
  name: z.string().trim().min(1, 'Escribe el nombre de la capa').max(120),
  department: z.enum(departments, { error: 'Elige un departamento' }),
  hasRole: z.boolean().default(false),
  fields: layerFieldsSchema.default([]),
  uniqueKeys: z.array(fieldKeySchema).default([]),
  addressFieldKey: fieldKeySchema.nullable().optional(),
  heatmapFieldKey: fieldKeySchema.nullable().optional(),
  icon: z.string().min(1).max(50).default(DEFAULT_LAYER_ICON),
  iconColor: hexColorSchema.default(DEFAULT_LAYER_ICON_COLOR),
  sortOrder: z.number().int().min(0).optional(),
};

function refineLayerReferences<T extends z.ZodRawShape>(schema: z.ZodObject<T>) {
  return schema.superRefine((v, ctx) => {
    const data = v as unknown as {
      fields?: LayerField[];
      uniqueKeys?: string[];
      addressFieldKey?: string | null;
      heatmapFieldKey?: string | null;
    };
    if (!data.fields) return;
    const byKey = new Map(data.fields.map((f) => [f.key, f]));
    for (const k of data.uniqueKeys ?? []) {
      if (!byKey.has(k)) {
        ctx.addIssue({ code: 'custom', path: ['uniqueKeys'], message: `El campo único "${k}" no existe` });
      }
    }
    if (data.addressFieldKey) {
      const f = byKey.get(data.addressFieldKey);
      if (!f) {
        ctx.addIssue({ code: 'custom', path: ['addressFieldKey'], message: 'El campo de dirección no existe' });
      } else if (f.type !== 'string') {
        ctx.addIssue({
          code: 'custom',
          path: ['addressFieldKey'],
          message: 'El campo de dirección debe ser de tipo texto',
        });
      }
    }
    if (data.heatmapFieldKey) {
      const f = byKey.get(data.heatmapFieldKey);
      if (!f) {
        ctx.addIssue({ code: 'custom', path: ['heatmapFieldKey'], message: 'El campo de valor no existe' });
      } else if (f.type !== 'number') {
        ctx.addIssue({
          code: 'custom',
          path: ['heatmapFieldKey'],
          message: 'El valor para mapas de calor debe ser un campo numérico',
        });
      }
    }
  });
}

export const createLayerSchema = refineLayerReferences(z.object(layerBaseShape));
export type CreateLayerInput = z.input<typeof createLayerSchema>;
export type CreateLayerData = z.output<typeof createLayerSchema>;

export const fieldRenameSchema = z.object({ from: fieldKeySchema, to: fieldKeySchema });
export type FieldRename = z.infer<typeof fieldRenameSchema>;

export const updateLayerSchema = refineLayerReferences(
  z.object({
    name: layerBaseShape.name.optional(),
    department: z.enum(departments).optional(),
    hasRole: z.boolean().optional(),
    fields: layerFieldsSchema.optional(),
    uniqueKeys: z.array(fieldKeySchema).optional(),
    addressFieldKey: fieldKeySchema.nullable().optional(),
    heatmapFieldKey: fieldKeySchema.nullable().optional(),
    icon: z.string().min(1).max(50).optional(),
    iconColor: hexColorSchema.optional(),
    sortOrder: z.number().int().min(0).optional(),
    /** Renombres de clave `from → to` que la UI pidió explícitamente (§7.2). */
    renames: z.array(fieldRenameSchema).default([]),
    /** Confirmación de conversión de tipo para estas claves (§7.2). */
    convertTypes: z.array(fieldKeySchema).default([]),
  }),
);
export type UpdateLayerInput = z.input<typeof updateLayerSchema>;
export type UpdateLayerData = z.output<typeof updateLayerSchema>;

export const layerIdParamSchema = z.coerce.number().int().positive();
