// Accès au système isolé derrière une interface : Electron en production, doublures dans les tests.
export interface Platform {
  dataDir: string;
  encryptSecret(plain: string): string;
  decryptSecret(stored: string): string;
  /** Renvoie le chemin choisi, ou null si l'utilisateur annule */
  askSavePath(defaultName: string, extension: string): Promise<string | null>;
  askOpenPath(extension: string): Promise<string | null>;
  askDirectory(): Promise<string | null>;
  htmlToPdf(html: string): Promise<Buffer>;
  openPath(path: string): Promise<void>;
}

let current: Platform | null = null;

export const setPlatform = (p: Platform) => {
  current = p;
};

export function platform(): Platform {
  if (!current) throw new Error("Plateforme non initialisée");
  return current;
}
