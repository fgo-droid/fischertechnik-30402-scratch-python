"""
Pilote Python pour l'interface fischertechnik Intelligent Interface (Réf. 30 402)
Optimisé pour Thonny / CoderDojo :
- Détection automatique du câble USB-Série (ex: TRENDnet TU-S9 / Prolific)
- Thread d'arrière-plan automatique (maintient le watchdog < 300 ms tout seul,
  permettant d'utiliser time.sleep() ou la console interactive '>>>' de Thonny !)
- Commandes en français (et en anglais) ultra-simples.

Installation dans Thonny :
  Menu "Outils" -> "Gérer les paquets..." -> chercher "pyserial" -> Installer
"""

import atexit
import threading
import time
from typing import Dict, Optional, Union
import serial
import serial.tools.list_ports


class Fischertechnik30402:
    """Pilote temps réel avec rafraîchissement automatique en arrière-plan pour le 30 402."""

    # Codes de commande RS-232 (Octet 1)
    CMD_ONLY_DIGITAL = 0xC1  # 193 : renvoie 1 octet (E1-E8)
    CMD_READ_EX      = 0xC5  # 197 : renvoie 3 octets (E1-E8 + EX)
    CMD_READ_EY      = 0xC9  # 201 : renvoie 3 octets (E1-E8 + EY)

    # États d'une sortie moteur (2 bits par moteur)
    STOP  = 0b00
    LEFT  = 0b01  # Gauche / Sens 2
    RIGHT = 0b10  # Droite / Sens 1
    BRAKE = 0b11  # Frein

    def __init__(self, port: Optional[str] = "COM20", auto_poll: bool = True):
        """
        Ouvre la connexion avec l'interface 30 402.
        :param port: Port série (par défaut 'COM20', ou None pour détection automatique).
        :param auto_poll: Si True (défaut), lance une boucle en tâche de fond toutes les 45 ms.
        """
        if port is None:
            port = self._auto_detect_port()
        else:
            # Si le port par défaut (ex: COM20) n'est pas branché mais qu'un autre adaptateur USB l'est
            available = [p.device.upper() for p in serial.tools.list_ports.comports()]
            if available and port.upper() not in available:
                port = self._auto_detect_port()

        self.port = port
        self.ser = serial.Serial(
            port=port,
            baudrate=9600,
            bytesize=serial.EIGHTBITS,
            parity=serial.PARITY_NONE,
            stopbits=serial.STOPBITS_ONE,
            timeout=0.15,
            xonxoff=False,
            rtscts=False,
            dsrdtr=False,
        )

        self._lock = threading.Lock()
        self.motors = [self.STOP, self.STOP, self.STOP, self.STOP]  # M1..M4
        self.inputs: Dict[str, bool] = {f"E{i}": False for i in range(1, 9)}
        self.analog_values: Dict[str, int] = {"EX": 0, "EY": 0}
        self.digital_byte: int = 0

        self._running = False
        self._thread: Optional[threading.Thread] = None
        self._toggle_analog = False

        # Coupe automatiquement les moteurs quand le script se termine dans Thonny
        atexit.register(self.close)

        if auto_poll:
            self._running = True
            self._thread = threading.Thread(target=self._poll_loop, daemon=True)
            self._thread.start()
            # Attend le premier cycle de lecture pour que les capteurs soient prêts immédiatement
            time.sleep(0.1)

        print(f"✅ Interface fischertechnik 30 402 connectée sur {self.port}")

    @staticmethod
    def _auto_detect_port() -> str:
        """Cherche automatiquement l'adaptateur USB-Série en ignorant les ports Bluetooth Windows."""
        ports = list(serial.tools.list_ports.comports())
        if not ports:
            raise RuntimeError(
                "Aucun port série détecté ! Vérifiez que le câble USB-Série (TU-S9) est branché."
            )
        # 1. Priorité aux vrais périphériques USB (ayant un Vendor ID USB) hors Bluetooth
        for p in ports:
            desc = (p.description or "").lower()
            if "bluetooth" in desc:
                continue
            if p.vid is not None or any(k in desc for k in ("prolific", "tu-s9", "usb", "ftdi", "ch340", "cp210")):
                return p.device
        # 2. Sinon premier port non-Bluetooth
        for p in ports:
            if "bluetooth" not in (p.description or "").lower():
                return p.device
        return ports[0].device

    def _build_motor_byte(self) -> int:
        return (
            self.motors[0]
            | (self.motors[1] << 2)
            | (self.motors[2] << 4)
            | (self.motors[3] << 6)
        )

    def _poll_loop(self) -> None:
        """Boucle d'arrière-plan (20 Hz) qui maintient le watchdog et lit E1..E8, EX, EY."""
        while self._running and self.ser and self.ser.is_open:
            analog_ch = "EX" if self._toggle_analog else "EY"
            self._toggle_analog = not self._toggle_analog
            try:
                self.update(read_analog=analog_ch)
            except Exception:
                pass
            time.sleep(0.045)

    def update(self, read_analog: Optional[str] = "EX") -> Optional[Dict[str, Union[bool, int]]]:
        """Effectue un échange série immédiat (appelé automatiquement par le thread d'arrière-plan)."""
        with self._lock:
            if not self.ser or not self.ser.is_open:
                return None

            motor_byte = self._build_motor_byte()
            if read_analog == "EX":
                cmd, expected = self.CMD_READ_EX, 3
            elif read_analog == "EY":
                cmd, expected = self.CMD_READ_EY, 3
            else:
                cmd, expected = self.CMD_ONLY_DIGITAL, 1

            self.ser.write(bytes([cmd, motor_byte]))
            resp = self.ser.read(expected)

            if len(resp) < expected:
                return None

            self.digital_byte = resp[0]
            for i in range(8):
                self.inputs[f"E{i + 1}"] = bool(self.digital_byte & (1 << i))

            if expected == 3 and read_analog in ("EX", "EY"):
                self.analog_values[read_analog] = (resp[1] << 8) | resp[2]

            state: Dict[str, Union[bool, int]] = dict(self.inputs)
            state.update(self.analog_values)
            return state

    # --- Méthodes en Français (Idéal CoderDojo / Thonny) ---

    def moteur(self, numero: Union[int, str], sens: Union[str, int] = "droite", duree: Optional[float] = None) -> None:
        """
        Commande un moteur M1 à M4 (ou une lampe / électrovanne).
        Exemples :
          ft.moteur(1, "droite")
          ft.moteur("M2", "gauche", duree=2.5)
          ft.moteur(1, "arret")
        """
        idx = int(str(numero).upper().replace("M", "").strip()) - 1
        if not 0 <= idx < 4:
            raise ValueError("Le numéro de moteur doit être entre 1 et 4 (M1 à M4).")

        if isinstance(sens, str):
            s = sens.lower().strip()
            if s in ("droite", "right", "marche", "on", "1", "avant"):
                code = self.RIGHT
            elif s in ("gauche", "left", "2", "arriere", "arrière"):
                code = self.LEFT
            elif s in ("frein", "brake", "3"):
                code = self.BRAKE
            else:
                code = self.STOP
        else:
            code = int(sens) & 0b11

        self.motors[idx] = code

        if duree is not None and duree > 0:
            time.sleep(duree)
            self.motors[idx] = self.STOP

    def lampe(self, numero: Union[int, str], etat: Union[bool, str] = True) -> None:
        """Allume (True / 'marche') ou éteint (False / 'arret') une lampe ou électrovanne sur M1..M4."""
        if isinstance(etat, str):
            actif = etat.lower().strip() in ("marche", "on", "true", "1", "oui")
        else:
            actif = bool(etat)
        self.moteur(numero, "droite" if actif else "arret")

    def arreter(self, numero: Optional[Union[int, str]] = None) -> None:
        """Arrête un moteur précis (ex: ft.arreter(1)) ou tous les moteurs si aucun numéro n'est donné."""
        if numero is None:
            self.motors = [self.STOP, self.STOP, self.STOP, self.STOP]
        else:
            self.moteur(numero, "arret")

    def entree(self, numero: Union[int, str]) -> bool:
        """
        Renvoie True si l'entrée E1..E8 est pressée/active, False sinon.
        Exemple : if ft.entree(1): ou if ft.entree("E1"):
        """
        idx = int(str(numero).upper().replace("E", "").strip())
        if not 1 <= idx <= 8:
            raise ValueError("Le numéro d'entrée doit être entre 1 et 8 (E1 à E8).")
        return self.inputs[f"E{idx}"]

    def attendre_entree(self, numero: Union[int, str], etat: bool = True) -> None:
        """Met le programme en pause jusqu'à ce que l'entrée E1..E8 soit pressée (etat=True) ou relâchée (etat=False)."""
        while self.entree(numero) != etat:
            time.sleep(0.02)

    def analog(self, canal: str = "EX") -> int:
        """Renvoie la valeur analogique (0 à 1000) de 'EX' ou 'EY'."""
        ch = canal.upper().strip()
        if ch not in ("EX", "EY"):
            raise ValueError("Le canal analogique doit être 'EX' ou 'EY'.")
        return self.analog_values[ch]

    # --- Alias en Anglais ---
    set_motor = moteur
    stop_all = arreter
    get_input = entree
    get_analog = analog

    def close(self) -> None:
        """Arrête tous les moteurs et ferme proprement le port série."""
        self._running = False
        if self._thread and self._thread.is_alive():
            self._thread.join(timeout=0.2)
        if getattr(self, "ser", None) and self.ser.is_open:
            try:
                with self._lock:
                    self.motors = [self.STOP] * 4
                    self.ser.write(bytes([self.CMD_ONLY_DIGITAL, 0x00]))
            except Exception:
                pass
            try:
                self.ser.close()
            except Exception:
                pass

    def __enter__(self) -> "Fischertechnik30402":
        return self

    def __exit__(self, exc_type, exc_val, exc_tb) -> None:
        self.close()


# Alias court pour les élèves dans Thonny
Interface30402 = Fischertechnik30402


if __name__ == "__main__":
    print("=== Test en direct de l'interface 30 402 (Ctrl+C ou Stop pour quitter) ===")
    ft = Interface30402()
    try:
        while True:
            e_str = " ".join(f"E{i}:{int(ft.entree(i))}" for i in range(1, 9))
            print(
                f"\r[{e_str}] | EX={ft.analog('EX'):4d} | EY={ft.analog('EY'):4d}",
                end="",
                flush=True,
            )
            time.sleep(0.05)
    except KeyboardInterrupt:
        print("\nArrêt.")
    finally:
        ft.close()
