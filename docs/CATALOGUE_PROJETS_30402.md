# 🗂️ Catalogue de Projets Calibrés pour l'Interface fischertechnik `30 402`

L'**Intelligent Interface `30 402`** possède un budget d'entrées/sorties très précis :
* **4 Sorties bidirectionnelles (`M1` à `M4`)** : moteurs 9V (2 sens + frein), lampes, LEDs, électroaimants, compresseur ou électrovannes.
* **8 Entrées digitales tout-ou-rien (`E1` à `E8`)** : boutons-poussoirs, fins de course, contacts magnétiques Reed, phototransistors.
* **2 Entrées analogiques (`EX` et `EY`, `0 à 1000`)** : photorésistances (LDR), thermistances (CTN), potentiomètres d'angle (`0 à 5 kΩ`).

---

## 🧠 1. Les 4 Astuces d'Ingénierie propres au `30 402`

1. **La règle « 1 Axe = 1 Moteur + 2 Fins de Course » :**
   Comme la liaison série RS-232 rafraîchit l'état toutes les ~45 ms (20 Hz), on ne compte pas d'impulsions d'encodeurs rapides. Chaque mouvement linéaire (tiroir, portique, barrière, ascenseur) est donc borné mécaniquement par **2 interrupteurs de fin de course** (`E_début` et `E_fin`).
2. **Fabriquer un Servomoteur de position grâce à `EX` et `EY` :**
   En couplant mécaniquement l'axe d'un moteur `M1` à un potentiomètre fischertechnik branché sur `EX`, on obtient une lecture d'angle absolue entre `0` et `1000` (sans aucun fin de course !).
3. **L'astuce des 2 LEDs « Tête-Bêche » (Feu Vert/Rouge sur une seule sortie `M`) :**
   Puisque chaque sortie `M1..M4` inverse sa polarité (`+` / `-`) entre `"droite"` et `"gauche"`, branchez **une LED Verte et une LED Rouge en parallèle mais en sens inverse** sur `M4` :
   * `ft.moteur(4, "droite")` → allume uniquement la **LED Verte** !
   * `ft.moteur(4, "gauche")` → allume uniquement la **LED Rouge** !
   * `ft.arreter(4)` → éteint les deux !
4. **Le Multiplieur Électropneumatique :**
   Une électrovanne ou un compresseur n'a besoin que d'un seul sens de courant : avec `M1` pour le compresseur, il reste `M2`, `M3` et `M4` pour commander **3 vérins pneumatiques indépendants** !

---

## 🏆 2. Répertoire des 8 Projets Clés en Main

### 🪙 Projet 1 : Le Distributeur Automatique à Monnayeur (Mouchoirs / Bonbons)
*(Voir le code complet dans [`exemples/05_distributeur_automatique.py`](../exemples/05_distributeur_automatique.py))*

Un grand classique de l'automatisme : l'utilisateur insère une pièce, le système vérifie le stock et la validité de la pièce, puis un tiroir motorisé pousse un paquet hors du magasin avant de revenir en position initiale.

| Borne | Composant fischertechnik | Rôle dans le modèle |
| :--- | :--- | :--- |
| **`E1`** | Phototransistor ou Micro-contact | Détecte l'insertion d'une pièce dans la fente |
| **`E2`** | Contact magnétique Reed | Contrôle d'authenticité de la pièce (aimant/métal) |
| **`E3`** | Bouton-poussoir en façade | Bouton Client « Distribuer le produit » |
| **`E4`** | Interrupteur de fin de course | Tiroir pousseur en position **ARRIÈRE (Repos)** |
| **`E5`** | Interrupteur de fin de course | Tiroir pousseur en position **AVANT (Éjection complète)** |
| **`EX`** | Photorésistance (sous la pile) | Détection de rupture de stock (`EX < 300` = lumière passe = stock vide) |
| **`M1`** | Moteur XS/Mini + Crémaillère | Tiroir pousseur (`droite` = éjecter, `gauche` = rentrer) |
| **`M2`** | 2 LEDs tête-bêche (Verte / Rouge) | Voyant d'état (`droite` = Vert Crédit OK, `gauche` = Rouge Stock vide / Rejet) |
| **`M3`** | Électroaimant / Clapet monnayeur | Aiguille la pièce vers la caisse ou vers le retour monnaie |

---

### 🛗 Projet 2 : L'Ascenseur à 3 Étages avec Portes Coulissantes Automatiques
Ce projet exploite **100 % des 8 entrées digitales** et **100 % des 4 sorties** :

| Borne | Composant | Rôle |
| :--- | :--- | :--- |
| **`E1`, `E2`, `E3`** | 3 Capteurs d'étage (Reed ou boutons) | Détectent la cabine au **RDC (`E1`)**, **1er (`E2`)** et **2e étage (`E3`)** |
| **`E4`, `E5`, `E6`** | 3 Boutons d'appel sur le palier | Appeler l'ascenseur au RDC, 1er ou 2e étage |
| **`E7`, `E8`** | 2 Fins de course sur la cabine | `E7` = Porte totalement ouverte / `E8` = Porte totalement fermée |
| **`EX`** | Photorésistance en bas de porte | Barrière optique anti-pincement (rouvre la porte si un passager traverse) |
| **`M1`** | Moteur + Treuil à câble | Montée (`droite`) et Descente (`gauche`) de la cabine |
| **`M2`** | Moteur de porte coulissante | Ouverture (`droite`) et Fermeture (`gauche`) de la porte |
| **`M3`** | Ampoule / LED | Éclairage intérieur de la cabine |
| **`M4`** | 2 LEDs tête-bêche | Flèche lumineuse de direction (Vert = Monte, Rouge = Descend) |

---

### 📦 Projet 3 : Centre de Tri Postal par Longueur de Colis & Code Magnétique
Comment mesurer la taille d'un colis sans caméra avec un `30 402` ? En mesurant **combien de millisecondes** le colis coupe le faisceau lumineux pendant que le tapis avance à vitesse constante !

* **`M1` :** Moteur du convoyeur principal.
* **`M2` :** Poussoir d'éjection n°1 (Petits colis) borné par les fins de course **`E3`** et **`E4`**.
* **`M3` :** Poussoir d'éjection n°2 (Grands colis) borné par les fins de course **`E5`** et **`E6`**.
* **`M4` :** Ampoule à lentille du faisceau optique.
* **`E1` :** Phototransistor mesurant la durée d'occultation $\Delta t$ du colis :
  * Si $\Delta t < 0,8\text{ s}$ → Petit colis (éjecté par `M2`).
  * Si $\Delta t \ge 0,8\text{ s}$ → Grand colis (éjecté par `M3`).
* **`E2` :** Contact Reed sous le tapis (identifie les colis « Express » contenant un aimant).
* **`EX` :** Photorésistance mesurant la clarté du colis (colis blanc vs colis sombre).

---

### 🤖 Projet 4 : Le Robot « Teach-In » (Bras Articulé à Apprentissage)
Un bras manipulateur à 2 axes équipés de potentiomètres d'angle (`EX` et `EY`) qui mémorise les gestes d'un opérateur humain pour les rejouer en boucle !

* **`M1` + `EX` :** Rotation de la tourelle avec recopie de position (`0 à 1000`).
* **`M2` + `EY` :** Élévation du bras avec recopie de position (`0 à 1000`).
* **`M3` :** Pince motorisée (avec fins de course **`E7`** ouverte / **`E8`** serrée) ou Électroaimant.
* **`M4` :** Voyant d'enregistrement.
* **`E1..E4` :** Joystick à 4 boutons (Gauche, Droite, Haut, Bas) pour piloter le bras manuellement.
* **`E5` :** Bouton **« REC Point »** (ajoute les coordonnées actuelles `(EX, EY, etat_pince)` dans une liste Python ou Scratch).
* **`E6` :** Bouton **« PLAY »** (le robot rejoue toute la séquence de coordonnées automatiquement !).

---

### 🚗 Projet 5 : Le Tunnel de Lavage Auto (« Car Wash ») à Palpeur de Profil
* **`M1` :** Translation du portique de lavage d'avant en arrière (fins de course **`E2`** entrée et **`E3`** sortie).
* **`M2` :** Rotation des brosses de lavage.
* **`M3` :** Levage du rouleau horizontal (fins de course **`E5`** bas / **`E6`** haut).
* **`M4` :** Feu bicolore d'entrée (LED Verte / LED Rouge tête-bêche).
* **`E1` :** Bouton de départ cycle.
* **`E4` :** Palpeur mécanique sur le rouleau horizontal : dès que le rouleau touche le capot ou le pare-brise de la voiture (`E4 == True`), `M3` soulève légèrement le rouleau pour épouser la carrosserie sans l'écraser !
* **`EX` :** Barrière lumineuse d'entrée vérifiant que la voiture est bien garée au centre.

---

### 💨 Projet 6 : Presse Industrielle Électropneumatique à « Commande Bimanuelle »
Dans l'industrie, pour protéger les mains de l'opérateur, une presse ne peut descendre que si les **deux boutons `E1` et `E2` sont maintenus enfoncés simultanément** (avec un écart inférieur à 0,5 seconde pour empêcher de bloquer un bouton avec un objet !).

* **`M1` :** Compresseur pneumatique.
* **`M2` :** Électrovanne n°1 (Vérin d'étau qui bride la pièce).
* **`M3` :** Électrovanne n°2 (Vérin de la presse verticale).
* **`M4` :** Électrovanne n°3 (Soufflette / Vérin d'éjection de la pièce finie).
* **`E1` & `E2` :** Boutons de sécurité Main Gauche et Main Droite.
* **`E3` :** Détecteur de pièce présente dans le gabarit.
* **`E4` :** Fin de course basse du vérin de presse.

---

### 🌻 Projet 7 : Le Traqueur Solaire Bi-Axe (Héliostat Intelligent)
* **`EX` & `EY` :** 2 photorésistances séparées par une petite cloison verticale au sommet du panneau solaire.
  * Tant que `EX - EY > 40`, le panneau tourne vers la gauche (`M1`).
  * Tant que `EY - EX > 40`, le panneau tourne vers la droite (`M1`).
* **`M1` :** Orientation Azimut (Est ↔ Ouest) entre les fins de course **`E1`** et **`E2`**.
* **`M2` :** Inclinaison Élevation (Haut ↔ Bas) entre les fins de course **`E3`** et **`E4`**.
* **Retour nocturne automatique :** Si `EX > 850` et `EY > 850` (nuit noire), le panneau revient tout seul se garer face à l'Est (`E1`) pour attendre le lever du soleil !

---

### 🔐 Projet 8 : Coffre-Fort à Combinaison Temporelle (Rythme / Morse) & Alarme
Avec un seul bouton (`E1`), comment créer un code secret impossible à deviner ? En mesurant la **durée** de chaque appui (Court `< 0,3 s` = `.` / Long `> 0,4 s` = `-`) !
* **`E1` :** Bouton de saisie du code Morse (ex: `S O S` = `... --- ...`).
* **`E2` :** Bouton « Valider / Verrouiller ».
* **`E3` & `E4` :** Fins de course du pêne motorisé (`E3` = Verrouillé, `E4` = Déverrouillé).
* **`E5` :** Contact magnétique Reed de fermeture de la porte.
* **`EX` :** Photorésistance interne (si la lumière entre dans le coffre alors que `E3` est verrouillé → effraction !).
* **`M1` :** Moteur du verrou (pêne dormant à crémaillère).
* **`M2` :** Voyant bicolore (Vert / Rouge).
* **`M3` :** Sirène / Buzzer ou Gyrophare d'alarme.
