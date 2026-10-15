import { stripAccents } from '@/shared/text';

/**
 * Normalización de direcciones (§8.7). Pura, con tests.
 * Minúsculas, sin acentos ni puntuación; abreviaturas unificadas; quita comuna/región/país;
 * separa calle (`streetNorm`) del número (`houseNumber`) y descarta complementos.
 */

export type NormalizedAddress = {
  /** Dirección completa normalizada (para similitud trigram). */
  addressNorm: string;
  /** Calle normalizada, sin número ni complementos. */
  streetNorm: string | null;
  /** Número de la dirección; null si S/N o ausente. */
  houseNumber: number | null;
  /** Complementos descartados (depto, block, casa...). */
  complement: string | null;
};

const ABBREVIATIONS: Record<string, string> = {
  av: 'avenida',
  avda: 'avenida',
  avd: 'avenida',
  ave: 'avenida',
  psje: 'pasaje',
  pje: 'pasaje',
  pas: 'pasaje',
  psj: 'pasaje',
  gral: 'general',
  pob: 'poblacion',
  pobl: 'poblacion',
  vla: 'villa',
  v: 'villa',
  sta: 'santa',
  sto: 'santo',
  pdte: 'presidente',
  pte: 'presidente',
  tte: 'teniente',
  cmdte: 'comandante',
  cap: 'capitan',
  sgto: 'sargento',
  alm: 'almirante',
  cnel: 'coronel',
  dr: 'doctor',
  dra: 'doctora',
  sr: 'senor',
  sra: 'senora',
  pza: 'plaza',
  cno: 'camino',
  cjon: 'callejon',
  dgo: 'diagonal',
  diag: 'diagonal',
  ctra: 'carretera',
  ptje: 'pasaje',
  lt: 'lote',
  mz: 'manzana',
  mza: 'manzana',
  pbl: 'poblacion',
};

const STOP_PHRASES = [
  'region metropolitana de santiago',
  'region metropolitana',
  'rm',
  'el bosque',
  'santiago de chile',
  'santiago',
  'chile',
  'comuna de',
  'comuna',
];

/** Palabras que marcan el inicio de un complemento (se descarta de ahí en adelante). */
const COMPLEMENT_MARKERS = new Set([
  'depto',
  'dpto',
  'departamento',
  'dep',
  'block',
  'blk',
  'casa',
  'local',
  'oficina',
  'of',
  'ofic',
  'piso',
  'torre',
  'bodega',
  'parcela',
  'sitio',
  'interior',
  'int',
  'km',
  'esquina',
  'esq',
]);

// Solo antes de un número («N° 12», «Nro 12», «No 12», «n12»): una palabra que empieza con n («Nogales») no es marcador.
// Los largos primero: si no, «n» se come el comienzo de «nro». `basicClean` ya quitó «°» y «º».
const NUMBER_MARKERS = /\b(?:numero|num|nro|no|n)\s*(?=\d)|#/g;

function basicClean(text: string): string {
  return stripAccents(text)
    .toLowerCase()
    .replace(/[°º]/g, '')
    .replace(/[^a-z0-9/#\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function expandAbbreviations(tokens: string[]): string[] {
  return tokens.map((t) => ABBREVIATIONS[t] ?? t);
}

function removeStopPhrases(text: string): string {
  let out = ` ${text} `;
  for (const phrase of STOP_PHRASES) {
    out = out.replace(new RegExp(`\\s${phrase.replace(/\s+/g, '\\s+')}\\s`, 'g'), ' ');
  }
  return out.replace(/\s+/g, ' ').trim();
}

export function normalizeAddress(input: string | null | undefined): NormalizedAddress {
  if (!input || !input.trim()) {
    return { addressNorm: '', streetNorm: null, houseNumber: null, complement: null };
  }

  let text = basicClean(input);
  text = text.replace(/\bs\s*\/\s*n\b/g, 'sn').replace(/\bsin numero\b/g, 'sn');
  text = text.replace(NUMBER_MARKERS, ' ');
  text = text.replace(/\s*-\s*/g, ' ').replace(/#/g, ' ').replace(/\s+/g, ' ').trim();
  text = removeStopPhrases(text);

  let tokens = expandAbbreviations(text.split(' ').filter(Boolean));
  // "villa italia" como sufijo del padrón ("RIQUELME 111 V ITALIA") no es parte de la calle
  const addressNorm = tokens.join(' ');

  // separar complemento
  let complementTokens: string[] = [];
  const markerIdx = tokens.findIndex((t) => COMPLEMENT_MARKERS.has(t));
  if (markerIdx > 0) {
    complementTokens = tokens.slice(markerIdx);
    tokens = tokens.slice(0, markerIdx);
  }

  // número: primer token numérico después de al menos una palabra de calle
  let houseNumber: number | null = null;
  let streetTokens = tokens;
  let numberIdx = -1;
  for (let i = 1; i < tokens.length; i++) {
    const t = tokens[i]!;
    if (/^\d{1,6}[a-z]?$/.test(t)) {
      numberIdx = i;
      break;
    }
    if (t === 'sn') {
      numberIdx = i;
      break;
    }
  }
  if (numberIdx > 0) {
    const numTok = tokens[numberIdx]!;
    houseNumber = numTok === 'sn' ? null : Number.parseInt(numTok, 10);
    streetTokens = tokens.slice(0, numberIdx);
    const rest = tokens.slice(numberIdx + 1);
    if (rest.length) complementTokens = [...rest, ...complementTokens];
  }

  const streetNorm = streetTokens.join(' ').trim() || null;
  const complement = complementTokens.join(' ').trim() || null;

  return { addressNorm, streetNorm, houseNumber, complement };
}

/** ¿Lo escrito parece una dirección (una palabra + un número)? Para la búsqueda (§8.6). */
export function looksLikeAddress(input: string): boolean {
  const n = normalizeAddress(input);
  return !!n.streetNorm && n.streetNorm.length >= 3 && (n.houseNumber !== null || n.streetNorm.split(' ').length >= 2);
}
