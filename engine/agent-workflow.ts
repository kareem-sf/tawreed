import type {
  AgentEvent,
  AgentStage,
  BoqItem,
  Classification,
  WorkPackage,
} from '../shared/types';
import { normalizeText } from './normalize';

export interface ClassificationMemory {
  descriptionKey: string;
  packageCode: string;
  packageNameEn: string;
  packageNameAr: string;
}

export function workflowEvent(
  stage: AgentStage,
  status: AgentEvent['status'],
  detail: string,
): AgentEvent {
  return { at: new Date().toISOString(), stage, status, detail };
}

export function memoryKey(description: string): string {
  return normalizeText(description).slice(0, 1_000);
}

/** Apply only exact, project-scoped, previously approved matches. */
export function applyClassificationMemory(
  items: BoqItem[],
  classifications: Classification[],
  memory: ClassificationMemory[],
): { classifications: Classification[]; applied: number } {
  const memoryByDescription = new Map(
    memory
      .filter((entry) => entry.descriptionKey && entry.packageCode)
      .map((entry) => [entry.descriptionKey, entry]),
  );
  const itemsById = new Map(items.map((item) => [item.id, item]));
  let applied = 0;
  const next = classifications.map((classification) => {
    const item = itemsById.get(classification.itemId);
    const entry = item ? memoryByDescription.get(memoryKey(item.description)) : undefined;
    if (!entry) return classification;
    applied++;
    return {
      itemId: classification.itemId,
      packageCode: entry.packageCode,
      packageNameEn: entry.packageNameEn,
      packageNameAr: entry.packageNameAr,
      confidence: 1,
      source: 'memory' as const,
    };
  });
  return { classifications: next, applied };
}

export function reviseClassification(
  classifications: Classification[],
  itemId: number,
  workPackage: WorkPackage,
): Classification[] {
  return classifications.map((classification) => classification.itemId === itemId
    ? {
        ...classification,
        packageCode: workPackage.code,
        packageNameEn: workPackage.nameEn,
        packageNameAr: workPackage.nameAr,
        confidence: 1,
        source: 'user',
      }
    : classification);
}

export function memoryFromApprovedReview(
  items: BoqItem[],
  classifications: Classification[],
  packages: WorkPackage[],
): ClassificationMemory[] {
  const packagesByCode = new Map(packages.map((workPackage) => [workPackage.code, workPackage]));
  const itemsById = new Map(items.map((item) => [item.id, item]));
  return classifications.flatMap((classification) => {
    const item = itemsById.get(classification.itemId);
    const workPackage = packagesByCode.get(classification.packageCode);
    if (!item || !workPackage || workPackage.code === 'WP-99') return [];
    return [{
      descriptionKey: memoryKey(item.description),
      packageCode: workPackage.code,
      packageNameEn: workPackage.nameEn,
      packageNameAr: workPackage.nameAr,
    }];
  });
}
