"""
Exemple 8 : Capteur Cyber-Physique & Gouvernance IA avec "Gemini Decisions API" (gemini-decision-1)
====================================================================================================
Utilise la nouvelle API `client.decisions.create(model="gemini-decision-1")` (latence 150-250 ms,
0 token de sortie facturé) pour transformer Gemini en capteur et routeur de décision BORNÉ
(Closed-set : 'noul' Yes/No, 'choice' et 'score') pour l'interface fischertechnik 30 402 !

PRÉREQUIS DANS THONNY :
  1. Menu "Outils" -> "Gérer les paquets..." -> chercher "google-genai" -> Installer (version >= 3.2.0)
  2. Créez une clé API gratuite sur https://aistudio.google.com/apikey
  3. Collez votre clé dans la variable GEMINI_API_KEY ci-dessous (ou définissez la variable
     d'environnement GEMINI_API_KEY sous Windows).
"""

import os
import sys
import time
from pathlib import Path

from google import genai

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from ft30402 import Interface30402

# Collez votre clé API Google AI Studio ici (ou laissez vide si GEMINI_API_KEY est dans Windows)
API_KEY = os.environ.get("GEMINI_API_KEY", "").strip()


def evaluer_situation_maquette(client: genai.Client, rapport_capteurs: str, consigne_operateur: str) -> dict:
    """
    Interroge `gemini-decision-1` en une seule passe (150-250 ms, 0 output token)
    avec les 3 types de questions fermées (noul, score) pour gouverner le 30 402 sans hallucination.
    """
    t0 = time.perf_counter()

    result = client.decisions.create(
        model="gemini-decision-1",
        input=(
            f"État temps réel de l'automate fischertechnik 30 402 (Ascenseur 2 étages) :\n"
            f"{rapport_capteurs}\n"
            f"Demande de l'opérateur : {consigne_operateur}"
        ),
        questions={
            # 1. Question Yes/No (noul) -> Agit comme un contact de sécurité Ladder —] [—
            "autoriser_mouvement": {
                "type": "noul",
                "instructions": (
                    "Le mouvement demandé est-il sûr et cohérent avec l'état des fins de course "
                    "(ne pas monter si déjà en haut sur E4, ne pas descendre si déjà en bas sur E3, "
                    "et pas d'obstacle EX > 750) ?"
                ),
            },
            # 2. Question Yes/No (noul) -> Direction à prendre
            "direction_montee": {
                "type": "noul",
                "instructions": "L'opérateur ou le cycle demande-t-il de MONTER vers l'étage supérieur (E4) ?",
            },
            # 3. Question Rubric Rating (score) -> Niveau de santé / fluidité
            "diagnostic_sante": {
                "type": "score",
                "instructions": "Évalue l'état opérationnel de l'ascenseur d'après les capteurs :",
                "criteria": [
                    "Anomalie critique, obstacle détecté (EX > 750) ou deux fins de course E3 et E4 actifs simultanément.",
                    "Cabine en transit entre deux étages (ni E3 ni E4 pressé), prudence requise.",
                    "Cabine parfaitement alignée à un étage (E3 ou E4 actif) et voie libre (EX normal).",
                ],
            },
        },
    )

    latence_ms = int((time.perf_counter() - t0) * 1000)
    ans_ok = result.answers["autoriser_mouvement"]
    ans_up = result.answers["direction_montee"]
    ans_score = result.answers["diagnostic_sante"]

    return {
        "latence_ms": latence_ms,
        "p_autoriser": ans_ok.noul,
        "confiance_autoriser": getattr(ans_ok, "confidence", 1.0),
        "p_monter": ans_up.noul,
        "score_sante": ans_score.score,
    }


if __name__ == "__main__":
    print("=== ⚡ TEST GEMINI DECISIONS API (gemini-decision-1) + FISCHERTECHNIK 30 402 ===")

    if not API_KEY:
        API_KEY = input("🔑 Entrez votre clé API Google AI Studio (AIza...) : ").strip()

    # Initialisation du client Gemini en v1beta (requis pour Decisions API)
    client = genai.Client(api_key=API_KEY, http_options={"api_version": "v1beta"})

    # Connexion à l'interface 30 402 (ou mode simulation si non branchée)
    ft = None
    try:
        ft = Interface30402("COM20")
    except Exception as e:
        print(f"ℹ️ Interface 30 402 non branchée ({e}) -> Test avec capteurs simulés.")

    try:
        while True:
            if ft:
                e1, e2, e3, e4 = ft.entree(1), ft.entree(2), ft.entree(3), ft.entree(4)
                ex_val = ft.analog("EX")
            else:
                # Valeurs simulées si vous testez sans le boîtier branché
                e1, e2, e3, e4 = False, False, True, False
                ex_val = 420

            rapport = (
                f"- Bouton Appel Bas (E1) = {e1} | Bouton Appel Haut (E2) = {e2}\n"
                f"- Capteur Étage Bas (E3) = {e3} | Capteur Étage Haut (E4) = {e4}\n"
                f"- Capteur Optique Obstacle (EX) = {ex_val} / 1000"
            )
            print(f"\n📊 État actuel :\n{rapport}")

            consigne = input("\n💬 Que voulez-vous faire ? (ex: 'Monter au 2e étage', ou 'q' pour quitter) : ").strip()
            if consigne.lower() in ("q", "quit", "exit"):
                break

            decision = evaluer_situation_maquette(client, rapport, consigne)
            print(
                f"\n⚡ Réponse Gemini Decision 1 en {decision['latence_ms']} ms (0 token de sortie) :\n"
                f"  • Autoriser mouvement (noul) : P(Oui) = {decision['p_autoriser']:.2f} "
                f"(Confiance = {decision['confiance_autoriser']:.2f})\n"
                f"  • Sens Montée (noul)         : P(Monter) = {decision['p_monter']:.2f}\n"
                f"  • Score Santé (0..2)         : {decision['score_sante']}"
            )

            # Exécution gouvernée sur le 30 402 si P(autoriser) >= 0.60
            if decision["p_autoriser"] >= 0.60:
                sens = "droite" if decision["p_monter"] >= 0.50 else "gauche"
                capteur_cible = 4 if sens == "droite" else 3
                print(f"✅ [GARDE-FOU OK] Activation M1 vers '{sens}' jusqu'au fin de course E{capteur_cible}...")
                if ft:
                    ft.moteur_jusqua(1, sens, capteur_cible, timeout=5.0)
            else:
                print("🛑 [GARDE-FOU BLOQUÉ] Mouvement refusé par la politique de sécurité !")

    finally:
        if ft:
            ft.close()
