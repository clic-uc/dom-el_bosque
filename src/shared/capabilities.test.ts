import { describe, expect, it } from 'vitest';
import { capabilities, capabilitiesFor, isAnalysisStalled, parseDeployMode } from './capabilities';

describe('capacidades por modo de despliegue', () => {
  it('cualquier valor distinto de staging es full (incluida la variable ausente)', () => {
    expect(parseDeployMode(undefined)).toBe('full');
    expect(parseDeployMode('')).toBe('full');
    expect(parseDeployMode('full')).toBe('full');
    expect(parseDeployMode('produccion')).toBe('full');
    expect(parseDeployMode('staging')).toBe('staging');
    expect(parseDeployMode(' Staging ')).toBe('staging');
  });

  it('los tests corren en modo full', () => {
    expect(capabilities.mode).toBe('full');
  });

  it('full mantiene el comportamiento de producción y no muestra avisos', () => {
    const c = capabilitiesFor('full');
    expect(c).toMatchObject({
      fileAttachments: true,
      importMaxMb: null,
      importMaxRows: null,
      externalGeocode: true,
      padronUpload: true,
      inlineJobs: false,
      fileStorage: 'disk',
      analysisStalledAfterSeconds: null,
    });
    expect(Object.values(c.notices).every((n) => n === null)).toBe(true);
  });

  it('staging reduce el alcance (§3 de STAGING.md) y explica cada límite', () => {
    const c = capabilitiesFor('staging');
    expect(c).toMatchObject({
      fileAttachments: false,
      importMaxMb: 4,
      importMaxRows: 1000,
      externalGeocode: false,
      padronUpload: false,
      inlineJobs: true,
      fileStorage: 'database',
    });
    expect(c.analysisStalledAfterSeconds).toBeGreaterThan(300); // más que maxDuration de las rutas
    expect(c.notices.banner).toMatch(/Ambiente de pruebas/);
    expect(c.notices.attachments).toMatch(/enlace/);
    expect(c.notices.padron).toMatch(/roles:import/);
    expect(c.notices.importLimits).toMatch(/ambiente de pruebas/);
    expect(c.notices.importLimits).toMatch(/solo se buscan en el padrón/);
  });
});

describe('isAnalysisStalled', () => {
  const staging = capabilitiesFor('staging');
  const now = new Date('2026-10-12T12:00:00Z');
  const ago = (s: number) => ({ startedAt: new Date(now.getTime() - s * 1000).toISOString() });

  it('nunca en modo full: el worker sigue o reintenta', () => {
    expect(
      isAnalysisStalled({ status: 'ANALYZING', progress: ago(3600) }, now, capabilitiesFor('full')),
    ).toBe(false);
  });

  it('en staging, solo un ANALYZING que superó el tiempo límite', () => {
    expect(isAnalysisStalled({ status: 'ANALYZING', progress: ago(60) }, now, staging)).toBe(false);
    expect(isAnalysisStalled({ status: 'ANALYZING', progress: ago(400) }, now, staging)).toBe(true);
    expect(isAnalysisStalled({ status: 'REVIEW', progress: ago(400) }, now, staging)).toBe(false);
    expect(isAnalysisStalled({ status: 'COMMITTING', progress: ago(400) }, now, staging)).toBe(false);
  });

  it('sin marca de inicio se considera interrumpido', () => {
    expect(isAnalysisStalled({ status: 'ANALYZING', progress: {} }, now, staging)).toBe(true);
    expect(isAnalysisStalled({ status: 'ANALYZING', progress: null }, now, staging)).toBe(true);
  });
});
