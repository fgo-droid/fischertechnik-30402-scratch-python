"""
Exemple 4 (Pédagogique) : Tableau de Bord Graphique (IHM / Jumeau Numérique) en Python
Ouvre une véritable fenêtre de contrôle industrielle (avec Tkinter, inclus dans Thonny) :
  - Clique sur les boutons pour commander M1 à M4 (Gauche / Arrêt / Droite)
  - Observe en temps réel les 8 voyants lumineux E1 à E8 (Vert = actif, Gris = inactif)
  - Visualise les 2 barres de mesure analogiques EX et EY (0 à 1000)
  - Affiche en direct les octets binaires envoyés et reçus sur le port RS-232 !
"""

import sys
import tkinter as tk
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from ft30402 import Interface30402


class TableauDeBord30402:
    def __init__(self, root: tk.Tk, port: str = "COM20"):
        self.root = root
        self.root.title(f"fischertechnik 30 402 — Tableau de Bord IHM ({port})")
        self.root.configure(bg="#f4f6f9", padx=16, pady=16)
        self.root.resizable(False, False)

        # Connexion à l'interface 30 402
        self.ft = Interface30402(port)

        # Bandeau titre
        header = tk.Frame(root, bg="#005596", padx=12, pady=8)
        header.pack(fill="x", pady=(0, 12))
        tk.Label(
            header,
            text="🧱 fischertechnik Intelligent Interface (30 402) — Poste de Contrôle",
            fg="white",
            bg="#005596",
            font=("Segoe UI", 13, "bold"),
        ).pack(side="left")

        # --- Section 1 : Commande des 4 Moteurs / Sorties (M1 à M4) ---
        frame_motors = tk.LabelFrame(
            root,
            text=" ⚙️ Sorties Moteurs / Lampes / Électrovannes (M1 à M4) ",
            font=("Segoe UI", 10, "bold"),
            bg="white",
            padx=12,
            pady=10,
        )
        frame_motors.pack(fill="x", pady=6)

        self.motor_status_labels = []
        for m in range(1, 5):
            row = tk.Frame(frame_motors, bg="white", pady=4)
            row.pack(fill="x")
            tk.Label(
                row,
                text=f"Sortie M{m} :",
                font=("Segoe UI", 10, "bold"),
                bg="white",
                width=12,
                anchor="w",
            ).pack(side="left")

            tk.Button(
                row,
                text="⏪ Gauche (Sens 2)",
                width=16,
                bg="#e8f0fe",
                command=lambda num=m: self.ft.moteur(num, "gauche"),
            ).pack(side="left", padx=4)

            tk.Button(
                row,
                text="⏹ Arrêt",
                width=12,
                bg="#fce8e6",
                fg="#c5221f",
                font=("Segoe UI", 9, "bold"),
                command=lambda num=m: self.ft.arreter(num),
            ).pack(side="left", padx=4)

            tk.Button(
                row,
                text="⏩ Droite / ON (Sens 1)",
                width=18,
                bg="#e8f0fe",
                command=lambda num=m: self.ft.moteur(num, "droite"),
            ).pack(side="left", padx=4)

            lbl = tk.Label(
                row,
                text="ARRÊT (00)",
                font=("Consolas", 10, "bold"),
                bg="#eee",
                fg="#555",
                width=14,
            )
            lbl.pack(side="right", padx=6)
            self.motor_status_labels.append(lbl)

        # --- Section 2 : Voyants des 8 Entrées Digitales (E1 à E8) ---
        frame_inputs = tk.LabelFrame(
            root,
            text=" 🔘 Entrées Digitales (Capteurs E1 à E8) ",
            font=("Segoe UI", 10, "bold"),
            bg="white",
            padx=12,
            pady=10,
        )
        frame_inputs.pack(fill="x", pady=6)

        self.input_indicators = []
        for i in range(1, 9):
            col = tk.Frame(frame_inputs, bg="white", padx=8)
            col.pack(side="left", expand=True)
            tk.Label(col, text=f"E{i}", font=("Segoe UI", 10, "bold"), bg="white").pack()
            lamp = tk.Label(
                col,
                text="0",
                font=("Consolas", 12, "bold"),
                width=4,
                height=2,
                bg="#d9d9d9",
                fg="#555",
                relief="groove",
            )
            lamp.pack(pady=4)
            self.input_indicators.append(lamp)

        # --- Section 3 : Entrées Analogiques EX & EY (0 à 1000) ---
        frame_analog = tk.LabelFrame(
            root,
            text=" 🌡️ Entrées Analogiques EX et EY (0 à 5 kΩ -> 0 à 1000) ",
            font=("Segoe UI", 10, "bold"),
            bg="white",
            padx=12,
            pady=10,
        )
        frame_analog.pack(fill="x", pady=6)

        self.ex_canvas, self.ex_rect, self.ex_label = self._create_bar(frame_analog, "EX")
        self.ey_canvas, self.ey_rect, self.ey_label = self._create_bar(frame_analog, "EY")

        # --- Section 4 : Espion Binaire Pédagogique ---
        frame_spy = tk.LabelFrame(
            root,
            text=" 🔍 Espion Protocole Série RS-232 (9600 bauds) ",
            font=("Segoe UI", 10, "bold"),
            bg="#1e1e1e",
            fg="#00ff9c",
            padx=12,
            pady=8,
        )
        frame_spy.pack(fill="x", pady=(6, 0))

        self.spy_label = tk.Label(
            frame_spy,
            text="",
            font=("Consolas", 10),
            bg="#1e1e1e",
            fg="#00ff9c",
            justify="left",
        )
        self.spy_label.pack(anchor="w")

        self.root.protocol("WM_DELETE_WINDOW", self.on_close)
        self.refresh_ui()

    def _create_bar(self, parent: tk.Widget, name: str):
        row = tk.Frame(parent, bg="white", pady=4)
        row.pack(fill="x")
        tk.Label(row, text=f"{name} :", font=("Segoe UI", 10, "bold"), bg="white", width=6).pack(
            side="left"
        )
        canvas = tk.Canvas(row, width=360, height=20, bg="#eee", highlightthickness=1)
        canvas.pack(side="left", padx=8)
        rect = canvas.create_rectangle(0, 0, 0, 20, fill="#E30613", width=0)
        lbl = tk.Label(row, text="0 / 1000", font=("Consolas", 10, "bold"), bg="white", width=12)
        lbl.pack(side="left")
        return canvas, rect, lbl

    def refresh_ui(self):
        # 1. Mise à jour de l'affichage des 4 moteurs
        names = {0: ("ARRÊT (00)", "#eee", "#555"), 1: ("GAUCHE (01)", "#cce5ff", "#004085"), 2: ("DROITE (10)", "#d4edda", "#155724")}
        for idx, code in enumerate(self.ft.motors):
            txt, bg, fg = names.get(code, ("FREIN (11)", "#fff3cd", "#856404"))
            self.motor_status_labels[idx].config(text=txt, bg=bg, fg=fg)

        # 2. Mise à jour des 8 voyants E1..E8
        for i in range(8):
            active = self.ft.entree(i + 1)
            self.input_indicators[i].config(
                text="1" if active else "0",
                bg="#2ecc71" if active else "#d9d9d9",
                fg="white" if active else "#555",
            )

        # 3. Mise à jour des jauges EX et EY
        ex = min(1000, max(0, self.ft.analog("EX")))
        ey = min(1000, max(0, self.ft.analog("EY")))
        self.ex_canvas.coords(self.ex_rect, 0, 0, int(ex * 0.36), 20)
        self.ex_label.config(text=f"{ex:4d} / 1000")
        self.ey_canvas.coords(self.ey_rect, 0, 0, int(ey * 0.36), 20)
        self.ey_label.config(text=f"{ey:4d} / 1000")

        # 4. Mise à jour de l'espion binaire
        m_byte = self.ft._build_motor_byte()
        e_byte = self.ft.digital_byte
        self.spy_label.config(
            text=(
                f"📤 Octets envoyés au 30 402  : [0xC5, 0b{m_byte:08b}] (M4..M1 = {m_byte:3d})\n"
                f"📥 Octet reçu des capteurs   : [0b{e_byte:08b}]       (E8..E1 = {e_byte:3d})"
            )
        )

        # Rafraîchissement toutes les 50 ms
        self.root.after(50, self.refresh_ui)

    def on_close(self):
        self.ft.close()
        self.root.destroy()


if __name__ == "__main__":
    port = sys.argv[1] if len(sys.argv) > 1 else "COM20"
    app_root = tk.Tk()
    app = TableauDeBord30402(app_root, port=port)
    app_root.mainloop()
