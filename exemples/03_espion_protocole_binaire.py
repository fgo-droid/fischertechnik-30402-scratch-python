"""
Exemple 3 (Pédagogique) : L'Espion Binaire RS-232
Affiche en temps réel dans Thonny les octets exacts (en Hexadécimal et en Binaire)
qui circulent entre le PC et le microprocesseur Intel 80C32 de l'interface 30 402.
Idéal en atelier CoderDojo pour comprendre les bits, les octets et les registres à décalage !
"""

import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from ft30402 import Interface30402

ft = Interface30402("COM20")

print("=== ESPION PROTOCOLE RS-232 (9600 bauds, 8N1) ===")
print("Appuyez sur E1 pour activer M1 à droite, E2 pour activer M2 à gauche.\n")

try:
    while True:
        # Si on appuie sur E1 -> M1 tourne à droite ; si E2 -> M2 tourne à gauche
        ft.moteur(1, "droite" if ft.entree(1) else "arret")
        ft.moteur(2, "gauche" if ft.entree(2) else "arret")

        # Reconstruction des octets envoyés et reçus pour affichage pédagogique
        cmd_byte = 0xC5
        motor_byte = ft._build_motor_byte()
        in_byte = ft.digital_byte
        ex_val = ft.analog("EX")

        print(
            f"\r📤 ENVOYÉ : [0x{cmd_byte:02X}, 0b{motor_byte:08b}] (M4..M1)  |  "
            f"📥 REÇU : [0b{in_byte:08b}] (E8..E1) + EX={ex_val:4d}",
            end="",
            flush=True,
        )
        time.sleep(0.08)
except KeyboardInterrupt:
    print("\nArrêt de l'espion binaire.")
