"""
Commutateur (Télérupteur) : chaque appui sur l'interrupteur E1
allume ou éteint la LED branchée sur M2.
(Ctrl+C ou bouton STOP rouge dans Thonny pour arrêter)
"""

from ft30402 import Interface30402
import time

ft = Interface30402("COM20")

led_allumee = False
print("Prêt ! Appuyez sur l'interrupteur en E1 pour commuter la LED en M2.")
print("(Astuce : si la LED ne s'allume pas, inversez ses 2 fiches sur M2 car une LED a un sens + / -)")

while True:
    # 1. Attend que l'on appuie sur E1
    ft.attendre_entree(1, True)

    # 2. Inverse l'état de la LED (Allumée <-> Éteinte)
    led_allumee = not led_allumee
    ft.lampe(2, led_allumee)
    print(f"E1 pressé -> LED en M2 : {'ALLUMÉE 💡' if led_allumee else 'ÉTEINTE ⚫'}")

    # 3. Attend que l'on relâche E1 (anti-rebond) avant le prochain appui
    ft.attendre_entree(1, False)
    time.sleep(0.05)
