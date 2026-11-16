"""
Exemple 5 : Distributeur Automatique à Monnayeur Intelligent (Mouchoirs / Bonbons)
Inspiré du grand classique fischertechnik Computing.

Câblage sur l'interface 30 402 :
  - E1 : Détecteur d'insertion de pièce (phototransistor ou micro-contact dans la fente)
  - E2 : Capteur magnétique Reed (vérifie que la pièce est authentique / métallique)
  - E3 : Bouton Client "Demander un paquet"
  - E4 : Fin de course ARRIÈRE du tiroir pousseur (position repos)
  - E5 : Fin de course AVANT du tiroir pousseur (paquet éjecté)
  - EX : Photorésistance sous la colonne de paquets (si EX < 300, la lumière passe -> stock vide !)
  - M1 : Moteur du tiroir pousseur (droite = pousser le paquet, gauche = reculer au repos)
  - M2 : Voyant lumineux (ou 2 LEDs tête-bêche : droite = Vert "Crédit OK", gauche = Rouge "Erreur/Vide")
"""

import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from ft30402 import Interface30402

ft = Interface30402("COM20")

SEUIL_STOCK_VIDE = 300  # En dessous de 300 (beaucoup de lumière sur EX), le magasin est vide


def ramener_tiroir_au_repos():
    """S'assure que le tiroir pousseur (M1) est bien reculé contre son fin de course arrière (E4)."""
    if not ft.entree(4):
        print("⏪ Remise en position initiale du tiroir pousseur (attente fin de course E4)...")
        ft.moteur(1, "gauche")
        ft.attendre_entree(4, True)
        ft.arreter(1)
        print("✅ Tiroir en position repos (E4).")


def distribuer_paquet():
    """Avance le poussoir jusqu'au fin de course avant (E5), puis le ramène au repos (E4)."""
    print("⏩ Éjection du paquet en cours (M1 -> droite jusqu'à E5)...")
    ft.moteur(1, "droite")
    ft.attendre_entree(5, True)
    ft.arreter(1)

    print("📦 Paquet libéré ! Pause de 0.5 s...")
    time.sleep(0.5)

    ramener_tiroir_au_repos()


print("=== 🪙 DISTRIBUTEUR AUTOMATIQUE FISCHERTECHNIK 30 402 ===")
ramener_tiroir_au_repos()

try:
    while True:
        # 1. Vérification du stock via la photorésistance EX
        if ft.analog("EX") < SEUIL_STOCK_VIDE and ft.analog("EX") > 0:
            ft.moteur(2, "gauche")  # Allume la LED Rouge (Stock épuisé)
            print(f"\r⚠️ STOCK ÉPUISÉ (EX={ft.analog('EX')}) ! Rechargez les paquets...", end="")
            time.sleep(0.5)
            continue

        ft.arreter(2)
        print("\n💰 En attente d'une pièce (activez E1, avec validation magnétique sur E2)...")

        # 2. Attente du passage d'une pièce devant E1
        ft.attendre_entree(1, True)
        print("🔍 Pièce détectée en E1 ! Vérification magnétique (E2) pendant 1 seconde...")

        # 3. Fenêtre de 1 seconde pour vérifier si le capteur Reed E2 détecte la pièce
        piece_valide = False
        debut = time.time()
        while time.time() - debut < 1.0:
            if ft.entree(2):
                piece_valide = True
                break
            time.sleep(0.02)

        # Mode souple pour les tests : si pas de capteur Reed câblé en E2, un appui long (>0.5s) sur E1 valide aussi
        if not piece_valide and ft.entree(1):
            piece_valide = True

        if not piece_valide:
            print("❌ Pièce refusée ! Clignotement d'erreur sur M2.")
            for _ in range(3):
                ft.moteur(2, "gauche")
                time.sleep(0.2)
                ft.arreter(2)
                time.sleep(0.2)
            continue

        # 4. Crédit validé -> Allume le voyant Vert (M2 droite) et attend le bouton Client (E3)
        ft.moteur(2, "droite")
        print("✅ Crédit accepté ! Appuyez sur le bouton de sélection (E3) pour recevoir votre paquet.")
        ft.attendre_entree(3, True)

        # 5. Cycle d'éjection aller-retour
        distribuer_paquet()
        ft.arreter(2)
        print("🎉 Merci de votre achat !")
        time.sleep(1.0)

except KeyboardInterrupt:
    print("\nArrêt du distributeur.")
finally:
    ft.close()
