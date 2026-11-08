# Guide d'installation

## Installer

1. Lancez `Cabinet Dentaire Setup 1.0.0.exe`.
2. Si Windows affiche « Windows a protégé votre ordinateur » : **Informations complémentaires**, puis **Exécuter quand même**. L'installateur n'est pas signé.
3. Choisissez le dossier d'installation, puis ouvrez **Cabinet Dentaire** depuis le bureau.

## Premier lancement

1. Saisissez le nom du cabinet et créez le **compte administrateur**. Il n'existe aucun compte par défaut.
2. Conservez ce mot de passe en lieu sûr.
3. Dans **Paramètres** : renseignez les coordonnées du cabinet (elles figurent sur les documents).
4. Dans **Personnel** : créez les comptes dentistes et secrétaires. Chacun change son mot de passe à la première connexion.

## Sauvegardes : à faire dès le premier jour

1. **Paramètres › Sauvegardes chiffrées** : choisissez une phrase secrète de 12 caractères minimum.
2. Notez-la **hors de l'ordinateur**. Sans elle, une sauvegarde est irrécupérable.
3. Cochez **Sauvegarde automatique**, puis **Enregistrer**.
4. Choisissez de préférence un dossier sur un disque externe : une panne du poste emporterait aussi des sauvegardes stockées dessus.
5. Testez une restauration une fois, sur un poste de test.

## Restaurer

**Paramètres › Sauvegardes** : **Restaurer**, puis saisissez la phrase secrète. Les données actuelles sont remplacées et une copie chiffrée est gardée dans `avant-restauration`.

## Où sont les données

`%APPDATA%\Cabinet Dentaire\donnees`

Désinstaller l'application ne supprime pas ce dossier.

## Protéger le poste

- Activez **BitLocker** : la base de travail n'est pas chiffrée sur le disque.
- Session Windows personnelle, avec mot de passe et verrouillage automatique.

## Essayer l'application

**Paramètres › Données de démonstration** charge 15 patients fictifs marqués DÉMO. Le bouton **Supprimer** les retire sans toucher aux vrais dossiers.
