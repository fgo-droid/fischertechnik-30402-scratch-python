# 🖨️ Fiche Mémo Atelier CoderDojo — fischertechnik 30 402

*(Astuce : ouvrez [`fiche_memo_imprimable.html`](./fiche_memo_imprimable.html) dans votre navigateur et appuyez sur `Ctrl+P` pour imprimer une fiche A4 Recto-Verso en couleur à plastifier sur les tables de l'atelier !)*

---

## 📄 RECTO : Le Matériel & Le Mode Scratch / TurboWarp

### 1. Le Bornier de Branchement (Façade droite du `30 402`)
Chaque composant se branche **verticalement** (un fil dans le trou du haut, un fil dans le trou du bas de la même colonne) :

| Colonne | Rôle | Quoi brancher ? |
| :--- | :--- | :--- |
| **`9V=...`** | Alimentation par fils | Batterie 9V *(uniquement si la prise jack ronde n'est pas branchée !)* |
| **`⊥` (LED 🔴)** | Témoin & Masse | La LED rouge s'allume dès que l'interface reçoit du 9V (`+` au centre). |
| **`E1`, `E2`** | Entrées Digitales 1 & 2 | Bouton-poussoir, contact magnétique Reed, phototransistor. |
| **`EX`, `EY`** | Entrées Analogiques | Photorésistance (lumière), CTN (température), potentiomètre → renvoie **`0` à `1000`**. |
| **`E3` à `E8`** | Entrées Digitales 3 à 8 | Boutons-poussoirs (fins de course), capteurs tout-ou-rien. |
| **`M1` à `M4`** | 4 Sorties Puissance (9V) | Moteurs (2 sens), ampoules, LEDs *(attention au sens +/- !)*, électrovannes. |

---

### 2. Charger l'extension dans TurboWarp
1. Ouvrir **[editor.turbowarp.org](https://editor.turbowarp.org/)** dans Chrome ou Edge.
2. Cliquer sur **Ajouter une extension** (en bas à gauche) → **Extension personnalisée**.
3. Choisir le fichier `ft30402_turbowarp.js` (ou coller l'URL GitHub Raw) et **cocher « Exécuter sans bac à sable » (*Run without sandbox*)**.

### 3. Les Blocs TurboWarp essentiels
* 🔌 `connecter l'interface 30 402` *(ouvre le menu de choix du port COM)*
* ⚙️ `moteur [M1 ▼] tourner vers [la droite (sens 1) ▼]`
* ⏱️ `moteur [M1 ▼] tourner vers [la gauche (sens 2) ▼] pendant (2) s`
* 💡 `sortie [M2 ▼] (lampe / vanne) sur [MARCHE ▼]`
* 🛑 `arrêter le moteur [M1 ▼]` / `arrêter tous les moteurs (M1 à M4)`
* ⚡ `quand l'entrée [E1 ▼] est [pressée (active) ▼]` *(bloc chapeau d'événement)*
* 🔘 `<l'entrée [E1 ▼] est pressée ?>` *(renvoie Vrai / Faux)*
* 🌡️ `(valeur analogique [EX ▼])` *(renvoie un nombre de `0` à `1000`)*
* 🔢 `(octet des entrées E8..E1 (en binaire))` *(affiche ex: `00000101`)*

---

## 📄 VERSO : Le Mode Python (Thonny) & Les 4 Défis

> ⚠️ **Règle d'or :** Fermez l'onglet TurboWarp avant de lancer Thonny (un seul programme à la fois sur le port `COM`).

### 1. Aide-mémoire Python (`ft30402.py`)

```python
from ft30402 import Interface30402
import time

ft = Interface30402("COM20")       # Se connecte à l'interface

# --- Commander les sorties M1 à M4 ---
ft.moteur(1, "droite")             # Sens : "droite", "gauche", "frein", "arret"
ft.moteur(1, "gauche", duree=1.5)  # Tourne 1,5 seconde puis s'arrête tout seul
ft.lampe(2, True)                  # True = allume M2, False = éteint M2
ft.arreter()                       # Coupe immédiatement M1, M2, M3 et M4

# --- Lire les capteurs E1 à E8, EX, EY ---
if ft.entree(1):                   # True si E1 est pressé, False sinon
    print("Bouton E1 enfoncé !")

ft.attendre_entree(1, True)        # Attend en pause jusqu'à l'appui sur E1
lumiere = ft.analog("EX")          # Nombre entre 0 et 1000
```

---

### 2. Les 4 Défis Progressifs de l'Atelier

* 🟢 **Défi 1 — Le Phare Télécommandé (15 min) :**
  Branche une LED sur `M2` et un bouton sur `E1`. Écris un programme qui allume la LED quand on appuie sur `E1`. *(Si la LED ne s'allume pas, retourne ses 2 fiches sur `M2` !)*
* 🟡 **Défi 2 — Le Télérupteur de Couloir (20 min) :**
  Modifie ton programme pour qu'une brève pression sur `E1` laisse la LED allumée, et qu'une deuxième pression sur `E1` l'éteigne.
* 🟠 **Défi 3 — Le Lampadaire Automatique (25 min) :**
  Branche une photorésistance sur `EX`. Affiche sa valeur à l'écran et programme l'allumage automatique de `M2` dès qu'on met la main au-dessus du capteur (`EX > 600`).
* 🔴 **Défi 4 — Le Jumeau Numérique (IHM) (30 min) :**
  Dessine sur la scène de Scratch (ou lance `04_tableau_de_bord_ihm.py`) un tableau de bord avec des voyants qui changent de couleur en direct quand on touche `E1..E8` et une barrière motorisée (`M1`) qui s'arrête dès qu'elle touche son capteur de fin de course !
