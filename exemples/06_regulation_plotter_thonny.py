"""
Exemple 6 : Régulation en Boucle Fermée avec le "Serial Monitor & Plotter" de Thonny !

COMMENT VOIR LES COURBES EN TEMPS RÉEL DANS THONNY :
  1. Dans le menu en haut de Thonny, cliquez sur : "Afficher" (View) -> cochez "Traceur" (Plotter).
  2. Lancez ce script avec le bouton Play vert (F5).
  3. Vous verrez simultanément :
     - En bas à gauche (Shell) : le Serial Monitor avec les valeurs numériques.
     - En bas à droite (Traceur) : le Serial Plotter qui trace en direct :
       * La Consigne (et son tunnel de tolérance Seuil_Haut / Seuil_Bas)
       * La Mesure réelle du capteur EX
       * L'activation du moteur ou chauffage M1 !

Astuce : Appuyez sur E1 ou E2 pour changer la consigne en direct (ou utilisez un 2e potentiomètre sur EY) !
"""

import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from ft30402 import Interface30402

ft = Interface30402("COM20")

# Choix du mode de régulation :
#   - "3POINTS"        : Asservissement de position (M1 tourne à droite ou à gauche pour rejoindre la consigne)
#   - "THERMOSTAT"     : Régulation Tout-ou-Rien avec Hystérésis (M1 chauffe/éclaire quand EX descend sous le seuil)
#   - "MAITRE_ESCLAVE" : La consigne est lue en direct sur le 2e capteur analogique EY !
MODE = "3POINTS"

consigne = 500
ZONE_MORTE = 25  # Hystérésis / Tolérance (±25 autour de la consigne)

# État interne pour le mode Thermostat à hystérésis
chauffage_actif = False

try:
    while True:
        mesure = ft.analog("EX")

        # Permet de modifier la consigne en direct avec les boutons E1 (+5) et E2 (-5)
        if ft.entree(1):
            consigne = min(950, consigne + 5)
        elif ft.entree(2):
            consigne = max(50, consigne - 5)

        if MODE == "MAITRE_ESCLAVE":
            consigne = ft.analog("EY")

        seuil_haut = consigne + ZONE_MORTE
        seuil_bas = consigne - ZONE_MORTE
        erreur = consigne - mesure

        if MODE in ("3POINTS", "MAITRE_ESCLAVE"):
            # Régulateur 3-Points (Gauche / Arrêt / Droite) avec zone morte
            if erreur > ZONE_MORTE:
                ft.moteur(1, "droite")
                commande_plot = 200  # Valeur affichée sur le graphe pour visualiser l'effort moteur
            elif erreur < -ZONE_MORTE:
                ft.moteur(1, "gauche")
                commande_plot = -200
            else:
                ft.arreter(1)
                commande_plot = 0

        elif MODE == "THERMOSTAT":
            # Régulateur Tout-ou-Rien (TOR) avec Hystérésis (évite le clignotement rapide autour du seuil)
            if mesure < seuil_bas:
                chauffage_actif = True
            elif mesure > seuil_haut:
                chauffage_actif = False

            ft.lampe(1, chauffage_actif)
            commande_plot = 200 if chauffage_actif else 0

        # Format reconnu automatiquement par le "Traceur" (Serial Plotter) de Thonny :
        print(
            f"Consigne:{consigne}  "
            f"Seuil_Haut:{seuil_haut}  "
            f"Seuil_Bas:{seuil_bas}  "
            f"Mesure_EX:{mesure}  "
            f"Commande_M1:{commande_plot}"
        )

        time.sleep(0.05)  # 20 échantillons / seconde

except KeyboardInterrupt:
    ft.close()
