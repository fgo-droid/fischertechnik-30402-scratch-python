"""
Pilote Python complet pour l'interface fischertechnik Intelligent Interface (Réf. 30 402)
Remplace 100 % des fonctionnalités historiques de LLWin (Lucky Logic for Windows) :
  - Détection automatique du câble USB-Série (ex: TRENDnet TU-S9 / Prolific)
  - Thread d'arrière-plan automatique (maintient le watchdog < 300 ms)
  - Support du Module d'Extension Esclave (extension=True -> M1..M8 et E1..E16 !)
  - Compteurs d'impulsions et Positionnement Absolu d'Axes (+1 en droite, -1 en gauche,
    avec prise d'origine sur fin de course, comme le 'Positionier-Baustein' de LLWin)
  - Macros mécatroniques et régulateurs intégrés.
"""

import atexit
import threading
import time
from typing import Dict, Optional, Union
import serial
import serial.tools.list_ports


class Fischertechnik30402:
    """Pilote temps réel avec rafraîchissement automatique et fonctions LLWin pour le 30 402."""

    # Codes de commande RS-232 pour 1 interface seule (M1..M4, E1..E8)
    CMD_ONLY_DIGITAL = 0xC1  # 193 : renvoie 1 octet (E1-E8)
    CMD_READ_EX      = 0xC5  # 197 : renvoie 3 octets (E1-E8 + EX)
    CMD_READ_EY      = 0xC9  # 201 : renvoie 3 octets (E1-E8 + EY)

    # Codes de commande RS-232 avec Module d'Extension Esclave (M1..M8, E1..E16)
    CMD_EXT_ONLY_DIGITAL = 0xC2  # 194 : envoie 3 octets, renvoie 2 octets (E1-E16)
    CMD_EXT_READ_EX      = 0xC6  # 198 : envoie 3 octets, renvoie 4 octets (E1-E16 + EX)
    CMD_EXT_READ_EY      = 0xCA  # 202 : envoie 3 octets, renvoie 4 octets (E1-E16 + EY)

    # États d'une sortie moteur (2 bits par moteur)
    STOP  = 0b00
    LEFT  = 0b01  # Gauche / Sens 2
    RIGHT = 0b10  # Droite / Sens 1
    BRAKE = 0b11  # Frein

    def __init__(self, port: Optional[str] = "COM20", auto_poll: bool = True, extension: bool = False):
        """
        Ouvre la connexion avec l'interface 30 402.
        :param port: Port série (par défaut 'COM20', ou None pour détection automatique).
        :param auto_poll: Si True (défaut), lance une boucle en tâche de fond toutes les 45 ms.
        :param extension: Si True, active le support du Module d'Extension (M5..M8 et E9..E16).
        """
        if port is None:
            port = self._auto_detect_port()
        else:
            available = [p.device.upper() for p in serial.tools.list_ports.comports()]
            if available and port.upper() not in available:
                port = self._auto_detect_port()

        self.port = port
        self.extension = extension
        self.max_motors = 8 if extension else 4
        self.max_inputs = 16 if extension else 8

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
        self.motors = [self.STOP] * 8  # M1..M8
        self.inputs: Dict[str, bool] = {f"E{i}": False for i in range(1, 17)}
        self._prev_inputs: Dict[str, bool] = {f"E{i}": False for i in range(1, 17)}
        self.analog_values: Dict[str, int] = {"EX": 0, "EY": 0}
        self.digital_byte: int = 0
        self.digital_byte_ext: int = 0

        # Compteurs d'impulsions et de position bidirectionnelle (façon LLWin)
        self.compteurs: Dict[str, int] = {f"E{i}": 0 for i in range(1, 17)}
        self.positions_axes: Dict[int, int] = {m: 0 for m in range(1, 9)}
        # Associe optionnellement un capteur d'impulsion E1..E8 à un moteur M1..M4 pour compter +1/-1
        self._axe_codeur_map: Dict[str, int] = {f"E{m}": m for m in range(1, 9)}

        self._running = False
        self._thread: Optional[threading.Thread] = None
        self._toggle_analog = False

        atexit.register(self.close)

        if auto_poll:
            self._running = True
            self._thread = threading.Thread(target=self._poll_loop, daemon=True)
            self._thread.start()
            time.sleep(0.1)

        ext_info = " (+ Module Extension M5..M8 / E9..E16)" if extension else ""
        print(f"✅ Interface fischertechnik 30 402 connectée sur {self.port}{ext_info}")

    @staticmethod
    def _auto_detect_port() -> str:
        """Cherche automatiquement l'adaptateur USB-Série en ignorant les ports Bluetooth Windows."""
        ports = list(serial.tools.list_ports.comports())
        if not ports:
            raise RuntimeError(
                "Aucun port série détecté ! Vérifiez que le câble USB-Série (TU-S9) est branché."
            )
        for p in ports:
            desc = (p.description or "").lower()
            if "bluetooth" in desc:
                continue
            if p.vid is not None or any(k in desc for k in ("prolific", "tu-s9", "usb", "ftdi", "ch340", "cp210")):
                return p.device
        for p in ports:
            if "bluetooth" not in (p.description or "").lower():
                return p.device
        return ports[0].device

    def _build_motor_byte(self, offset: int = 0) -> int:
        return (
            self.motors[offset + 0]
            | (self.motors[offset + 1] << 2)
            | (self.motors[offset + 2] << 4)
            | (self.motors[offset + 3] << 6)
        )

    def _poll_loop(self) -> None:
        while self._running and self.ser and self.ser.is_open:
            analog_ch = "EX" if self._toggle_analog else "EY"
            self._toggle_analog = not self._toggle_analog
            try:
                self.update(read_analog=analog_ch)
            except Exception:
                pass
            time.sleep(0.045)

    def update(self, read_analog: Optional[str] = "EX") -> Optional[Dict[str, Union[bool, int]]]:
        """Effectue un échange série complet avec l'interface (et son extension éventuelle)."""
        with self._lock:
            if not self.ser or not self.ser.is_open:
                return None

            m_byte_1 = self._build_motor_byte(0)

            if not self.extension:
                if read_analog == "EX":
                    cmd, expected = self.CMD_READ_EX, 3
                elif read_analog == "EY":
                    cmd, expected = self.CMD_READ_EY, 3
                else:
                    cmd, expected = self.CMD_ONLY_DIGITAL, 1
                tx_packet = bytes([cmd, m_byte_1])
            else:
                m_byte_2 = self._build_motor_byte(4)
                if read_analog == "EX":
                    cmd, expected = self.CMD_EXT_READ_EX, 4
                elif read_analog == "EY":
                    cmd, expected = self.CMD_EXT_READ_EY, 4
                else:
                    cmd, expected = self.CMD_EXT_ONLY_DIGITAL, 2
                tx_packet = bytes([cmd, m_byte_1, m_byte_2])

            self.ser.write(tx_packet)
            resp = self.ser.read(expected)

            if len(resp) < expected:
                return None

            self.digital_byte = resp[0]
            for i in range(8):
                self._update_input_and_counters(f"E{i + 1}", bool(self.digital_byte & (1 << i)))

            if self.extension:
                self.digital_byte_ext = resp[1]
                for i in range(8):
                    self._update_input_and_counters(f"E{i + 9}", bool(self.digital_byte_ext & (1 << i)))
                if expected == 4 and read_analog in ("EX", "EY"):
                    self.analog_values[read_analog] = (resp[2] << 8) | resp[3]
            else:
                if expected == 3 and read_analog in ("EX", "EY"):
                    self.analog_values[read_analog] = (resp[1] << 8) | resp[2]

            state: Dict[str, Union[bool, int]] = dict(self.inputs)
            state.update(self.analog_values)
            return state

    def _update_input_and_counters(self, key: str, current: bool) -> None:
        """Met à jour l'entrée et incrémente les compteurs d'impulsions sur front montant (0 -> 1)."""
        prev = self._prev_inputs[key]
        if current and not prev:
            self.compteurs[key] += 1
            # Si cette entrée sert de codeur à un moteur, met à jour la position (+1 en droite, -1 en gauche)
            m_num = self._axe_codeur_map.get(key)
            if m_num:
                dir_code = self.motors[m_num - 1]
                if dir_code == self.LEFT:
                    self.positions_axes[m_num] -= 1
                else:
                    self.positions_axes[m_num] += 1
        self._prev_inputs[key] = current
        self.inputs[key] = current

    # --- Commandes de base (Français) ---

    def moteur(self, numero: Union[int, str], sens: Union[str, int] = "droite", duree: Optional[float] = None) -> None:
        idx = int(str(numero).upper().replace("M", "").strip()) - 1
        if not 0 <= idx < self.max_motors:
            raise ValueError(f"Le numéro de moteur doit être entre 1 et {self.max_motors}.")

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
        if isinstance(etat, str):
            actif = etat.lower().strip() in ("marche", "on", "true", "1", "oui")
        else:
            actif = bool(etat)
        self.moteur(numero, "droite" if actif else "arret")

    def arreter(self, numero: Optional[Union[int, str]] = None) -> None:
        if numero is None:
            self.motors = [self.STOP] * 8
        else:
            self.moteur(numero, "arret")

    def entree(self, numero: Union[int, str]) -> bool:
        idx = int(str(numero).upper().replace("E", "").strip())
        if not 1 <= idx <= self.max_inputs:
            raise ValueError(f"Le numéro d'entrée doit être entre 1 et {self.max_inputs}.")
        return self.inputs[f"E{idx}"]

    def attendre_entree(self, numero: Union[int, str], etat: bool = True, timeout: Optional[float] = None) -> bool:
        debut = time.time()
        while self.entree(numero) != etat:
            if timeout is not None and (time.time() - debut) >= timeout:
                return False
            time.sleep(0.02)
        return True

    def analog(self, canal: str = "EX") -> int:
        ch = canal.upper().strip()
        if ch not in ("EX", "EY"):
            raise ValueError("Le canal analogique doit être 'EX' ou 'EY'.")
        return self.analog_values[ch]

    # --- Fonctions Avancées LLWin (Positionnement par impulsions, Fins de course, Servomoteur) ---

    def compteur(self, entree_num: Union[int, str]) -> int:
        """Renvoie le nombre d'impulsions comptées sur l'entrée E1..E8."""
        idx = int(str(entree_num).upper().replace("E", "").strip())
        return self.compteurs[f"E{idx}"]

    def raz_compteur(self, entree_num: Union[int, str]) -> None:
        """Remet à zéro le compteur d'impulsions sur l'entrée E1..E8."""
        idx = int(str(entree_num).upper().replace("E", "").strip())
        self.compteurs[f"E{idx}"] = 0

    def moteur_jusqua(
        self,
        moteur_num: Union[int, str],
        sens: str,
        entree_fin: Union[int, str],
        timeout: float = 8.0,
    ) -> bool:
        """Fait tourner un moteur jusqu'à ce que le fin de course soit atteint (ou timeout)."""
        self.moteur(moteur_num, sens)
        atteint = self.attendre_entree(entree_fin, True, timeout=timeout)
        self.arreter(moteur_num)
        return atteint

    def moteur_impulsions(
        self,
        moteur_num: Union[int, str],
        sens: str,
        nb_impulsions: int,
        entree_codeur: Union[int, str],
        timeout: float = 15.0,
    ) -> None:
        """Fait tourner un moteur pendant exactement `nb_impulsions` sur l'entrée codeur (façon LLWin)."""
        idx_in = int(str(entree_codeur).upper().replace("E", "").strip())
        key = f"E{idx_in}"
        depart = self.compteurs[key]
        debut = time.time()
        self.moteur(moteur_num, sens)
        while (self.compteurs[key] - depart) < nb_impulsions and (time.time() - debut) < timeout:
            time.sleep(0.02)
        self.arreter(moteur_num)

    def prise_origine_axe(
        self,
        moteur_num: int,
        entree_zero: Union[int, str],
        entree_codeur: Union[int, str],
        sens_retour: str = "gauche",
    ) -> None:
        """
        Bloc 'Referenzpunkt / Homing' de LLWin :
        Ramène l'axe contre son fin de course zéro et réinitialise sa position à 0.
        """
        idx_in = int(str(entree_codeur).upper().replace("E", "").strip())
        self._axe_codeur_map[f"E{idx_in}"] = moteur_num
        self.moteur_jusqua(moteur_num, sens_retour, entree_zero)
        self.positions_axes[moteur_num] = 0
        self.compteurs[f"E{idx_in}"] = 0

    def aller_position_axe(
        self,
        moteur_num: int,
        cible_impulsions: int,
        entree_codeur: Union[int, str],
        timeout: float = 15.0,
    ) -> None:
        """
        Bloc 'Positionier-Baustein' de LLWin :
        Déplace automatiquement le moteur vers la position absolue `cible_impulsions` (+ en droite, - en gauche).
        """
        idx_in = int(str(entree_codeur).upper().replace("E", "").strip())
        self._axe_codeur_map[f"E{idx_in}"] = moteur_num
        debut = time.time()
        while (time.time() - debut) < timeout:
            erreur = cible_impulsions - self.positions_axes[moteur_num]
            if erreur == 0:
                break
            self.moteur(moteur_num, "droite" if erreur > 0 else "gauche")
            time.sleep(0.02)
        self.arreter(moteur_num)

    # --- Alias en Anglais ---
    set_motor = moteur
    stop_all = arreter
    get_input = entree
    get_analog = analog

    def close(self) -> None:
        self._running = False
        if self._thread and self._thread.is_alive():
            self._thread.join(timeout=0.2)
        if getattr(self, "ser", None) and self.ser.is_open:
            try:
                with self._lock:
                    self.motors = [self.STOP] * 8
                    if self.extension:
                        self.ser.write(bytes([self.CMD_EXT_ONLY_DIGITAL, 0x00, 0x00]))
                    else:
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
