import { api } from "@/lib/api";

/** Génère un PDF (dialogue d'enregistrement côté système) ; les erreurs s'affichent dans une alerte native */
export async function generateDocument(input: Parameters<typeof api.documents.generate>[0], after?: () => void) {
  try {
    const path = await api.documents.generate(input);
    if (path) after?.();
  } catch (e) {
    window.dispatchEvent(new CustomEvent("cabinet-erreur", { detail: e instanceof Error ? e.message : "Erreur" }));
  }
}
