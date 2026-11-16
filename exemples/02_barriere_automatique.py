"""
Exemple 2 : Barrière de parking automatique intelligente
Montage fischertechnik :
  - M1 : Moteur de la barrière (droite = monter, gauche = descendre)
  - M2 : Lampe ou LED rouge d'avertissement
  - E1 : Bouton d'ouverture (demande d'accès)
  - E2 : Fin de course HAUT (barrière totalement ouverte)
  - E3 : Fin de course BAS (barrière totalement fermée)
  - EX : Photorésistance (barrière lumineuse de sécurité : empêche de refermer si une voiture passe)
"""

import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from ft30402 import Interface30402

ft = Interface30402("COM20")

SEUIL_OBSTACLE_EX = 600  # Si la résistance EX dépasse 600 (ombre sur la photorésistance), un véhicule est présent

print("=== Barrière automatique prête ===")
print("Appuyez sur E1 pour ouvrir la barrière.")

while True:
    # 1. Attente d'une demande d'ouverture sur E1
    ft.attendre_entree(1, True)
    print("🚗 Véhicule détecté ! Ouverture de la barrière...")

    # 2. Allume le feu clignotant M2 et monte la barrière (M1) jusqu'au fin de course haut (E2)
    ft.lampe(2, True)
    ft.moteur(1, "droite")
    ft.attendre_entree(2, True)
    ft.arreter(1)
    print("✅ Barrière ouverte (fin de course E2 atteint). Attente 3 secondes...")
    time.sleep(3.0)

    # 3. Sécurité : tant qu'un obstacle coupe le faisceau lumineux sur EX, on ne referme pas
    while ft.analog("EX") > SEUIL_OBSTACLE_EX:
        print(f"⚠️ Obstacle sous la barrière (EX={ft.analog('EX')}) ! Maintien ouverte...")
        time.sleep(0.3)

    # 4. Fermeture jusqu'au fin de course bas (E3)
    print("⬇️ Fermeture de la barrière...")
    ft.moteur(1, "gauche")
    ft.attendre_entree(3, True)
    ft.arreter(1)
    ft.lampe(2, False)
    print("🔒 Barrière fermée (fin de course E3 atteint).\n")
