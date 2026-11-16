// Name: fischertechnik 30 402
// ID: ft30402webserial
// Description: Pilote l'interface fischertechnik Intelligent Interface (30 402) directement via Web Serial (RS-232).
// By: CoderDojo / Antigravity
// License: MIT

(function (Scratch) {
  "use strict";

  if (!Scratch.extensions.unsandboxed) {
    throw new Error(
      "L'extension fischertechnik 30 402 doit être chargée SANS bac à sable (cocher 'Run without sandbox')."
    );
  }

  // Codes du protocole fischertechnik 30 402 (RS-232 9600 8N1)
  const CMD_ONLY_DIGITAL = 0xc1; // 193 : renvoie 1 octet (E1..E8)
  const CMD_READ_EX = 0xc5;      // 197 : renvoie 3 octets (E1..E8, EX_H, EX_L)
  const CMD_READ_EY = 0xc9;      // 201 : renvoie 3 octets (E1..E8, EY_H, EY_L)

  const MOTOR_STOP = 0b00;
  const MOTOR_LEFT = 0b01;
  const MOTOR_RIGHT = 0b10;
  const MOTOR_BRAKE = 0b11;

  // Icône SVG fischertechnik (Rouge & Bleu)
  const ICON_SVG =
    "data:image/svg+xml;utf8," +
    encodeURIComponent(`
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40">
        <rect width="40" height="40" rx="8" fill="#005596"/>
        <rect x="6" y="10" width="28" height="20" rx="3" fill="#ffffff"/>
        <circle cx="14" cy="20" r="5" fill="#e30613"/>
        <rect x="22" y="15" width="8" height="10" rx="1.5" fill="#e30613"/>
      </svg>
    `);

  class Fischertechnik30402Extension {
    constructor() {
      this.port = null;
      this.reader = null;
      this.writer = null;
      this.isConnected = false;
      this.isPolling = false;

      // État des 4 sorties moteurs M1..M4 (2 bits chacune)
      this.motors = [MOTOR_STOP, MOTOR_STOP, MOTOR_STOP, MOTOR_STOP];

      // État des 8 entrées digitales E1..E8
      this.digitalByte = 0;
      this.inputs = {
        E1: false,
        E2: false,
        E3: false,
        E4: false,
        E5: false,
        E6: false,
        E7: false,
        E8: false,
      };

      // État des 2 entrées analogiques 16 bits EX et EY
      this.analog = {
        EX: 0,
        EY: 0,
      };

      this._toggleAnalog = false;

      // Arrêt automatique des moteurs quand on clique sur le bouton STOP rouge de TurboWarp
      if (Scratch.vm && Scratch.vm.runtime) {
        Scratch.vm.runtime.on("PROJECT_STOP_ALL", () => {
          this.stopAllMotors();
        });
      }
    }

    getInfo() {
      return {
        id: "ft30402webserial",
        name: "fischertechnik 30 402",
        color1: "#E30613", // Rouge fischertechnik
        color2: "#B8040F",
        color3: "#005596", // Bleu fischertechnik
        menuIconURI: ICON_SVG,
        blockIconURI: ICON_SVG,
        blocks: [
          {
            blockType: Scratch.BlockType.LABEL,
            text: "Connexion RS-232 (Web Serial)",
          },
          {
            opcode: "connectPort",
            blockType: Scratch.BlockType.COMMAND,
            text: "connecter l'interface 30 402",
          },
          {
            opcode: "disconnectPort",
            blockType: Scratch.BlockType.COMMAND,
            text: "déconnecter l'interface 30 402",
          },
          {
            opcode: "isInterfaceConnected",
            blockType: Scratch.BlockType.BOOLEAN,
            text: "interface 30 402 connectée ?",
          },
          "---",
          {
            blockType: Scratch.BlockType.LABEL,
            text: "Moteurs, Lampes & Électrovannes (M1-M4)",
          },
          {
            opcode: "setMotorDirection",
            blockType: Scratch.BlockType.COMMAND,
            text: "moteur [MOTOR] tourner vers [DIR]",
            arguments: {
              MOTOR: {
                type: Scratch.ArgumentType.STRING,
                menu: "motorMenu",
                defaultValue: "1",
              },
              DIR: {
                type: Scratch.ArgumentType.STRING,
                menu: "directionMenu",
                defaultValue: "RIGHT",
              },
            },
          },
          {
            opcode: "runMotorForSeconds",
            blockType: Scratch.BlockType.COMMAND,
            text: "moteur [MOTOR] tourner vers [DIR] pendant [SECS] s",
            arguments: {
              MOTOR: {
                type: Scratch.ArgumentType.STRING,
                menu: "motorMenu",
                defaultValue: "1",
              },
              DIR: {
                type: Scratch.ArgumentType.STRING,
                menu: "directionMenu",
                defaultValue: "RIGHT",
              },
              SECS: {
                type: Scratch.ArgumentType.NUMBER,
                defaultValue: 1,
              },
            },
          },
          {
            opcode: "setOutputState",
            blockType: Scratch.BlockType.COMMAND,
            text: "sortie [MOTOR] (lampe / vanne) sur [STATE]",
            arguments: {
              MOTOR: {
                type: Scratch.ArgumentType.STRING,
                menu: "motorMenu",
                defaultValue: "1",
              },
              STATE: {
                type: Scratch.ArgumentType.STRING,
                menu: "onOffMenu",
                defaultValue: "ON",
              },
            },
          },
          {
            opcode: "stopMotor",
            blockType: Scratch.BlockType.COMMAND,
            text: "arrêter le moteur [MOTOR]",
            arguments: {
              MOTOR: {
                type: Scratch.ArgumentType.STRING,
                menu: "motorMenu",
                defaultValue: "1",
              },
            },
          },
          {
            opcode: "stopAllMotors",
            blockType: Scratch.BlockType.COMMAND,
            text: "arrêter tous les moteurs (M1 à M4)",
          },
          "---",
          {
            blockType: Scratch.BlockType.LABEL,
            text: "Capteurs & Entrées (E1-E8, EX, EY)",
          },
          {
            opcode: "whenInputPressed",
            blockType: Scratch.BlockType.HAT,
            text: "quand l'entrée [INPUT] est [STATE]",
            arguments: {
              INPUT: {
                type: Scratch.ArgumentType.STRING,
                menu: "inputMenu",
                defaultValue: "E1",
              },
              STATE: {
                type: Scratch.ArgumentType.STRING,
                menu: "inputStateMenu",
                defaultValue: "PRESSED",
              },
            },
          },
          {
            opcode: "isInputActive",
            blockType: Scratch.BlockType.BOOLEAN,
            text: "l'entrée [INPUT] est pressée ?",
            arguments: {
              INPUT: {
                type: Scratch.ArgumentType.STRING,
                menu: "inputMenu",
                defaultValue: "E1",
              },
            },
          },
          {
            opcode: "getAnalogValue",
            blockType: Scratch.BlockType.REPORTER,
            text: "valeur analogique [CHANNEL]",
            arguments: {
              CHANNEL: {
                type: Scratch.ArgumentType.STRING,
                menu: "analogMenu",
                defaultValue: "EX",
              },
            },
          },
          {
            opcode: "getBinaryInputs",
            blockType: Scratch.BlockType.REPORTER,
            text: "octet des entrées E8..E1 (en binaire)",
          },
        ],
        menus: {
          motorMenu: {
            acceptReporters: true,
            items: [
              { text: "M1", value: "1" },
              { text: "M2", value: "2" },
              { text: "M3", value: "3" },
              { text: "M4", value: "4" },
            ],
          },
          directionMenu: {
            acceptReporters: false,
            items: [
              { text: "la droite (sens 1)", value: "RIGHT" },
              { text: "la gauche (sens 2)", value: "LEFT" },
              { text: "arrêt", value: "STOP" },
              { text: "frein", value: "BRAKE" },
            ],
          },
          onOffMenu: {
            acceptReporters: false,
            items: [
              { text: "MARCHE", value: "ON" },
              { text: "ARRÊT", value: "OFF" },
            ],
          },
          inputMenu: {
            acceptReporters: true,
            items: ["E1", "E2", "E3", "E4", "E5", "E6", "E7", "E8"],
          },
          inputStateMenu: {
            acceptReporters: false,
            items: [
              { text: "pressée (active)", value: "PRESSED" },
              { text: "relâchée (inactive)", value: "RELEASED" },
            ],
          },
          analogMenu: {
            acceptReporters: true,
            items: ["EX", "EY"],
          },
        },
      };
    }

    // --- Gestion Web Serial ---

    async _requestPortWithFallback() {
      if (!("serial" in navigator)) {
        alert(
          "Web Serial n'est pas supporté par ce navigateur. Utilisez Google Chrome, Microsoft Edge ou TurboWarp Desktop."
        );
        return null;
      }

      try {
        // Essai direct (fonctionne si l'appel bénéficie d'une activation utilisateur directe)
        return await navigator.serial.requestPort();
      } catch (err) {
        if (err.name === "NotFoundError") {
          // L'utilisateur a annulé la boîte de dialogue
          return null;
        }
        // Si la VM Scratch a perdu le geste utilisateur (SecurityError), on affiche un bouton HTML direct
        return await this._showPermissionButtonOverlay();
      }
    }

    _showPermissionButtonOverlay() {
      return new Promise((resolve) => {
        const overlay = document.createElement("div");
        overlay.style.cssText = `
          position: fixed; inset: 0; background: rgba(0, 0, 0, 0.55);
          display: flex; align-items: center; justify-content: center; z-index: 999999;
          font-family: sans-serif;
        `;

        const card = document.createElement("div");
        card.style.cssText = `
          background: white; padding: 24px 32px; border-radius: 12px;
          box-shadow: 0 10px 30px rgba(0,0,0,0.3); text-align: center; max-width: 400px;
          border-top: 6px solid #E30613;
        `;

        const title = document.createElement("h3");
        title.textContent = "Connexion fischertechnik 30 402";
        title.style.margin = "0 0 12px 0";

        const desc = document.createElement("p");
        desc.textContent =
          "Cliquez sur le bouton ci-dessous puis choisissez votre adaptateur USB-Série (ex: COM3) :";
        desc.style.cssText = "color: #444; font-size: 14px; margin-bottom: 20px;";

        const btn = document.createElement("button");
        btn.textContent = "🔌 Choisir le port série (COM)";
        btn.style.cssText = `
          background: #005596; color: white; border: none; padding: 12px 20px;
          font-size: 15px; font-weight: bold; border-radius: 6px; cursor: pointer;
          margin-right: 8px;
        `;

        const cancelBtn = document.createElement("button");
        cancelBtn.textContent = "Annuler";
        cancelBtn.style.cssText = `
          background: #eee; color: #333; border: none; padding: 12px 16px;
          font-size: 14px; border-radius: 6px; cursor: pointer;
        `;

        btn.onclick = async () => {
          try {
            const port = await navigator.serial.requestPort();
            document.body.removeChild(overlay);
            resolve(port);
          } catch (e) {
            document.body.removeChild(overlay);
            resolve(null);
          }
        };

        cancelBtn.onclick = () => {
          document.body.removeChild(overlay);
          resolve(null);
        };

        card.appendChild(title);
        card.appendChild(desc);
        card.appendChild(btn);
        card.appendChild(cancelBtn);
        overlay.appendChild(card);
        document.body.appendChild(overlay);
      });
    }

    async connectPort() {
      if (this.isConnected) {
        return;
      }

      const port = await this._requestPortWithFallback();
      if (!port) return;

      try {
        await port.open({
          baudRate: 9600,
          dataBits: 8,
          stopBits: 1,
          parity: "none",
          flowControl: "none",
        });

        this.port = port;
        this.writer = port.writable.getWriter();
        this.reader = port.readable.getReader();
        this.isConnected = true;

        // Démarre la boucle de rafraîchissement (maintient le watchdog < 300 ms)
        this._startPollingLoop();
      } catch (err) {
        console.error("Erreur d'ouverture du port 30 402 :", err);
        alert("Impossible d'ouvrir le port série : " + err.message);
        await this.disconnectPort();
      }
    }

    async disconnectPort() {
      this.isPolling = false;
      this.motors = [MOTOR_STOP, MOTOR_STOP, MOTOR_STOP, MOTOR_STOP];

      try {
        if (this.writer) {
          // Envoie un dernier ordre d'arrêt aux moteurs avant de fermer
          await this.writer.write(new Uint8Array([CMD_ONLY_DIGITAL, 0x00]));
          this.writer.releaseLock();
        }
      } catch (_) {}

      try {
        if (this.reader) {
          await this.reader.cancel();
          this.reader.releaseLock();
        }
      } catch (_) {}

      try {
        if (this.port) {
          await this.port.close();
        }
      } catch (_) {}

      this.writer = null;
      this.reader = null;
      this.port = null;
      this.isConnected = false;
    }

    _buildMotorByte() {
      return (
        this.motors[0] |
        (this.motors[1] << 2) |
        (this.motors[2] << 4) |
        (this.motors[3] << 6)
      );
    }

    async _readBytesWithTimeout(expectedCount, timeoutMs = 150) {
      const buffer = new Uint8Array(expectedCount);
      let offset = 0;
      const startTime = performance.now();

      while (offset < expectedCount) {
        if (performance.now() - startTime > timeoutMs) {
          return null; // Timeout
        }

        const timeoutPromise = new Promise((resolve) =>
          setTimeout(() => resolve({ timeout: true }), timeoutMs)
        );
        const readResult = await Promise.race([
          this.reader.read(),
          timeoutPromise,
        ]);

        if (readResult.timeout || readResult.done) {
          return null;
        }

        const chunk = readResult.value;
        if (chunk) {
          for (let i = 0; i < chunk.length && offset < expectedCount; i++) {
            buffer[offset++] = chunk[i];
          }
        }
      }
      return buffer;
    }

    async _startPollingLoop() {
      if (this.isPolling) return;
      this.isPolling = true;

      while (this.isPolling && this.isConnected && this.writer && this.reader) {
        try {
          const channel = this._toggleAnalog ? "EX" : "EY";
          this._toggleAnalog = !this._toggleAnalog;

          const cmd = channel === "EX" ? CMD_READ_EX : CMD_READ_EY;
          const motorByte = this._buildMotorByte();

          await this.writer.write(new Uint8Array([cmd, motorByte]));
          const resp = await this._readBytesWithTimeout(3, 150);

          if (resp && resp.length === 3) {
            this.digitalByte = resp[0];
            for (let i = 0; i < 8; i++) {
              this.inputs[`E${i + 1}`] = Boolean(this.digitalByte & (1 << i));
            }
            this.analog[channel] = (resp[1] << 8) | resp[2];
          }
        } catch (err) {
          console.warn("Erreur de communication avec le 30 402 :", err);
          // Si le câble USB a été débranché, on coupe proprement
          if (err.name === "NetworkError" || err.name === "InvalidStateError") {
            await this.disconnectPort();
            break;
          }
        }

        // Pause de 45 ms (~20 cycles/seconde, largement sous le watchdog de 300 ms)
        await new Promise((r) => setTimeout(r, 45));
      }
    }

    // --- Implémentation des Blocs ---

    isInterfaceConnected() {
      return this.isConnected;
    }

    _parseMotorIndex(motorArg) {
      const str = String(motorArg).toUpperCase().replace("M", "").trim();
      const idx = parseInt(str, 10) - 1;
      return idx >= 0 && idx < 4 ? idx : 0;
    }

    _parseDirection(dirArg) {
      const d = String(dirArg).toUpperCase();
      if (d === "RIGHT" || d === "DROITE" || d === "1") return MOTOR_RIGHT;
      if (d === "LEFT" || d === "GAUCHE" || d === "2") return MOTOR_LEFT;
      if (d === "BRAKE" || d === "FREIN" || d === "3") return MOTOR_BRAKE;
      return MOTOR_STOP;
    }

    setMotorDirection(args) {
      const idx = this._parseMotorIndex(args.MOTOR);
      this.motors[idx] = this._parseDirection(args.DIR);
    }

    async runMotorForSeconds(args) {
      const idx = this._parseMotorIndex(args.MOTOR);
      const dir = this._parseDirection(args.DIR);
      const secs = Math.max(0, Number(args.SECS) || 0);

      this.motors[idx] = dir;
      await new Promise((r) => setTimeout(r, secs * 1000));
      this.motors[idx] = MOTOR_STOP;
    }

    setOutputState(args) {
      const idx = this._parseMotorIndex(args.MOTOR);
      const state = String(args.STATE).toUpperCase();
      this.motors[idx] = state === "ON" || state === "MARCHE" || state === "1" ? MOTOR_RIGHT : MOTOR_STOP;
    }

    stopMotor(args) {
      const idx = this._parseMotorIndex(args.MOTOR);
      this.motors[idx] = MOTOR_STOP;
    }

    stopAllMotors() {
      this.motors = [MOTOR_STOP, MOTOR_STOP, MOTOR_STOP, MOTOR_STOP];
    }

    _normalizeInputName(inputArg) {
      const str = String(inputArg).toUpperCase().trim();
      if (str.startsWith("E")) return str;
      const num = parseInt(str, 10);
      if (num >= 1 && num <= 8) return `E${num}`;
      return "E1";
    }

    whenInputPressed(args) {
      const key = this._normalizeInputName(args.INPUT);
      const active = Boolean(this.inputs[key]);
      return args.STATE === "RELEASED" ? !active : active;
    }

    isInputActive(args) {
      const key = this._normalizeInputName(args.INPUT);
      return Boolean(this.inputs[key]);
    }

    getAnalogValue(args) {
      const ch = String(args.CHANNEL).toUpperCase().trim();
      if (ch === "EY") return this.analog.EY;
      return this.analog.EX;
    }

    getBinaryInputs() {
      return this.digitalByte.toString(2).padStart(8, "0");
    }
  }

  Scratch.extensions.register(new Fischertechnik30402Extension());
})(Scratch);
