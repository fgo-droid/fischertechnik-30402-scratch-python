"""
Exemple 7 (Game Changer Industrie 4.0) : Jumeau Numérique & Maintenance Prédictive !

CONCEPT :
  Un automate classique se contente d'attendre qu'un capteur de fin de course (E2) soit touché.
  Un "Jumeau Numérique Prédictif" chronomètre chaque mouvement au millième de seconde :
    1. PHASE D'APPRENTISSAGE (Cycles 1 à 3) :
       Le robot mesure tout seul combien de temps met normalement le mécanisme pour aller
       de E1 à E2 (ex: 1420 ms) et revenir de E2 à E1 (ex: 1380 ms).
    2. PHASE DE SURVEILLANCE PRÉDICTIVE (Cycles suivants) :
       - Si vous freinez légèrement la roue ou l'axe avec le doigt (+20 % à +45 % de temps),
         le Jumeau Numérique détecte l'usure/friction AVANT la panne !
       - Si l'axe est bloqué (> 160 % du temps nominal appris), il coupe immédiatement
         le moteur en sécurité (Auto-Trip) sans attendre qu'un pignon casse !

EXPÉRIENCE DANS THONNY :
  Ouvrez "Afficher -> Traceur (Plotter)" dans Thonny, lancez le script, laissez-le faire
  3 cycles normaux, puis freinez légèrement le moteur M1 avec votre doigt au 4e cycle !
"""

import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from ft30402 import Interface30402


class JumeauNumeriqueAxe:
    """Modèle prédictif qui apprend la signature temporelle d'un axe motorisé et détecte les anomalies."""

    def __init__(self, ft: Interface30402, moteur_num: int = 1, nb_cycles_apprentissage: int = 3):
        self.ft = ft
        self.moteur_num = moteur_num
        self.nb_apprentissage = nb_cycles_apprentissage
        self.historique_durees = {"droite": [], "gauche": []}
        self.duree_nominale = {"droite": None, "gauche": None}
        self.sante_mecanique = 100  # Score de santé de 0 à 100 %
        self.dernier_diagnostic = "CALIBRATION EN COURS"

    def deplacer_avec_surveillance(self, sens: str, cap_cible: int, timeout_absolu: float = 8.0) -> dict:
        """
        Déplace le moteur jusqu'au capteur cible tout en comparant en temps réel
        avec le Jumeau Numérique.
        """
        nominal = self.duree_nominale.get(sens)
        seuil_coupure = (nominal * 1.60) if nominal else timeout_absolu

        debut = time.perf_counter()
        self.ft.moteur(self.moteur_num, sens)

        bloque = False
        while not self.ft.entree(cap_cible):
            ecoule = time.perf_counter() - debut
            if ecoule >= seuil_coupure:
                bloque = True
                break
            time.sleep(0.015)

        self.ft.arreter(self.moteur_num)
        duree = time.perf_counter() - debut

        # --- Analyse par le Jumeau Numérique ---
        if bloque:
            self.sante_mecanique = 0
            self.dernier_diagnostic = f"🚨 BLOCAGE CRITIQUE ({duree*1000:.0f} ms > limite {seuil_coupure*1000:.0f} ms)"
            ecart_pct = 100.0
        elif nominal is None:
            # Phase d'apprentissage initial
            self.historique_durees[sens].append(duree)
            restant = self.nb_apprentissage - len(self.historique_durees[sens])
            if restant <= 0:
                self.duree_nominale[sens] = sum(self.historique_durees[sens]) / len(self.historique_durees[sens])
                self.dernier_diagnostic = f"✅ CALIBRÉ (Nominal {sens} = {self.duree_nominale[sens]*1000:.0f} ms)"
            else:
                self.dernier_diagnostic = f"🧠 APPRENTISSAGE ({len(self.historique_durees[sens])}/{self.nb_apprentissage})"
            self.sante_mecanique = 100
            ecart_pct = 0.0
        else:
            # Comparaison entre le Jumeau Numérique (nominal) et le Réel (duree)
            ecart_pct = ((duree - nominal) / nominal) * 100.0
            self.sante_mecanique = max(0, min(100, int(100 - max(0.0, ecart_pct) * 1.5)))

            if ecart_pct > 25.0:
                self.dernier_diagnostic = (
                    f"⚠️ ALERTE MAINTENANCE : Friction / Perte de vitesse (+{ecart_pct:.1f}%)"
                )
            elif ecart_pct < -25.0:
                self.dernier_diagnostic = (
                    f"⚠️ ANOMALIE : Mouvement trop rapide ({ecart_pct:.1f}% -> Glissement / Jeu ?)"
                )
            else:
                self.dernier_diagnostic = f"🟢 NOMINAL (Écart {ecart_pct:+.1f}%)"

        return {
            "duree_ms": int(duree * 1000),
            "attendu_ms": int((nominal or duree) * 1000),
            "sante": self.sante_mecanique,
            "ecart_pct": ecart_pct,
            "bloque": bloque,
            "diagnostic": self.dernier_diagnostic,
        }


if __name__ == "__main__":
    ft = Interface30402("COM20")
    jumeau = JumeauNumeriqueAxe(ft, moteur_num=1, nb_cycles_apprentissage=3)

    print("=== 🔮 JUMEAU NUMÉRIQUE & MAINTENANCE PRÉDICTIVE 4.0 ===")
    print("Câblage : Moteur sur M1, Fin de course Gauche sur E1, Fin de course Droite sur E2.")
    print("(Si vous n'avez pas d'axe monté, appuyez vous-même sur E2 puis E1 en rythme régulier,")
    print(" puis retardez volontairement votre appui au 4e cycle pour simuler une friction !)\n")

    cycle = 1
    try:
        # Remise à l'origine sur E1 avant de commencer
        if not ft.entree(1):
            print("Retour initial vers E1...")
            ft.moteur_jusqua(1, "gauche", 1)

        while True:
            # 1. Trajet ALLER (M1 Droite jusqu'à E2)
            res_aller = jumeau.deplacer_avec_surveillance("droite", cap_cible=2)
            # Ligne formatée pour le Serial Plotter (Traceur) de Thonny + Console :
            print(
                f"Attendu_ms:{res_aller['attendu_ms']}  "
                f"Reel_ms:{res_aller['duree_ms']}  "
                f"Sante:{res_aller['sante']*10}  "
                f"| Cycle {cycle} (Aller) -> {res_aller['diagnostic']}"
            )
            if res_aller["bloque"]:
                print("🛑 Arrêt du cycle suite au blocage mécanique détecté par le Jumeau Numérique.")
                break

            time.sleep(0.4)

            # 2. Trajet RETOUR (M1 Gauche jusqu'à E1)
            res_retour = jumeau.deplacer_avec_surveillance("gauche", cap_cible=1)
            print(
                f"Attendu_ms:{res_retour['attendu_ms']}  "
                f"Reel_ms:{res_retour['duree_ms']}  "
                f"Sante:{res_retour['sante']*10}  "
                f"| Cycle {cycle} (Retour) -> {res_retour['diagnostic']}"
            )
            if res_retour["bloque"]:
                print("🛑 Arrêt du cycle suite au blocage mécanique détecté par le Jumeau Numérique.")
                break

            cycle += 1
            time.sleep(0.4)

    except KeyboardInterrupt:
        print("\nArrêt.")
    finally:
        ft.close()
