import { defineConfig } from "prisma/config";

// Le CLI ne sert qu'à générer le client et le SQL : la base réelle vit dans le dossier de l'utilisateur.
export default defineConfig({ schema: "prisma/schema.prisma", datasource: { url: "file:./prisma/dev-cli.db" } });
