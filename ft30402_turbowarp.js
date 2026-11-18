// Name: fischertechnik 30 402
// ID: ft30402webserial
// Description: Pilote l'interface fischertechnik Intelligent Interface (30 402) via Web Serial avec Modules Mécatroniques, GRAFCET, Régulation et Serial Plotter.
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

  // Palette de couleurs douces et reposantes à l'écran (1 teinte par sous-groupe)
  const COLOR_BASE_1 = "#2E6B9E";  // Bleu acier doux (blocs de base)
  const COLOR_BASE_2 = "#24557D";
  const COLOR_BASE_3 = "#1B3F5E";

  const COLOR_MECA_1 = "#2E856E";  // Vert sauge doux (modules mécatroniques combinés)
  const COLOR_MECA_2 = "#236856";
  const COLOR_MECA_3 = "#194B3E";

  const COLOR_GRAF_1 = "#5C6BC0";  // Indigo doux (blocs automate GRAFCET)
  const COLOR_GRAF_2 = "#485499";
  const COLOR_GRAF_3 = "#363F73";

  const COLOR_REG_1 = "#B86B2B";   // Ambre / Cuivre doux (Régulation & Serial Plotter)
  const COLOR_REG_2 = "#945420";
  const COLOR_REG_3 = "#703E16";

  // Icône SVG fischertechnik adoucie
  const ICON_SVG =
    "data:image/svg+xml;utf8," +
    encodeURIComponent(`
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40">
        <rect width="40" height="40" rx="8" fill="#2E6B9E"/>
        <rect x="6" y="10" width="28" height="20" rx="3" fill="#f8fafc"/>
        <circle cx="14" cy="20" r="5" fill="#d9534f"/>
        <rect x="22" y="15" width="8" height="10" rx="1.5" fill="#2E856E"/>
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
      // Mode clignoteur non-bloquant par sortie (0 = fixe/off, 250 = rapide, 450 = normal, 800 = lent en ms)
      this.blinkPeriodsMs = [0, 0, 0, 0];

      // État des 8 entrées digitales E1..E8 + Compteurs d'impulsions (fronts montants)
      this.digitalByte = 0;
      this.inputs = {
        E1: false, E2: false, E3: false, E4: false,
        E5: false, E6: false, E7: false, E8: false,
      };
      this.prevInputs = {
        E1: false, E2: false, E3: false, E4: false,
        E5: false, E6: false, E7: false, E8: false,
      };
      this.pulseCounts = {
        E1: 0, E2: 0, E3: 0, E4: 0,
        E5: 0, E6: 0, E7: 0, E8: 0,
      };
      // Position absolue par axe (façon Positionier-Baustein de LLWin : +1 en droite, -1 en gauche)
      this.axisPositions = [0, 0, 0, 0];
      this.encoderMap = { E1: 0, E2: 1, E3: 2, E4: 3 };

      // État des 2 entrées analogiques 16 bits EX et EY
      this.analog = {
        EX: 0,
        EY: 0,
      };

      // État de l'automate GRAFCET intégré
      this.grafcetStep = 0;

      // État Régulation & Serial Plotter
      this.plotterSetpoint = 500;
      this.plotterBand = 25;
      this.history = []; // Derniers échantillons { ex, ey, sp, m1 }
      this.maxHistory = 140;
      this.plotterPanel = null;
      this.plotterCanvas = null;
      this.monitorLogEl = null;
      this.plotterPaused = false;
      this.thermostatStates = [false, false, false, false];

      // État du Jumeau Numérique Prédictif (Maintenance Prédictive 4.0)
      this.twinBaselineMs = {}; // Clé "M1_RIGHT_E2" -> durée nominale en ms
      this.twinHealthScore = 100;
      this.twinDiagnostic = "CALIBRATION";

      this._toggleAnalog = false;

      // Boucle d'échantillonnage du Plotter (même en mode hors-ligne pour tester)
      setInterval(() => {
        if (this.plotterPanel && !this.plotterPaused) {
          this._pushPlotterSample();
          this._renderPlotterWidget();
        }
      }, 60);

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
        color1: COLOR_BASE_1,
        color2: COLOR_BASE_2,
        color3: COLOR_BASE_3,
        menuIconURI: ICON_SVG,
        blockIconURI: ICON_SVG,
        blocks: [
          {
            blockType: Scratch.BlockType.LABEL,
            text: "🔌 Connexion RS-232 (Web Serial)",
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
            text: "⚙️ Sorties de base (M1 à M4)",
          },
          {
            opcode: "setMotorDirection",
            blockType: Scratch.BlockType.COMMAND,
            text: "moteur [MOTOR] tourner vers [DIR]",
            arguments: {
              MOTOR: { type: Scratch.ArgumentType.STRING, menu: "motorMenu", defaultValue: "1" },
              DIR: { type: Scratch.ArgumentType.STRING, menu: "directionMenu", defaultValue: "RIGHT" },
            },
          },
          {
            opcode: "runMotorForSeconds",
            blockType: Scratch.BlockType.COMMAND,
            text: "moteur [MOTOR] tourner vers [DIR] pendant [SECS] s",
            arguments: {
              MOTOR: { type: Scratch.ArgumentType.STRING, menu: "motorMenu", defaultValue: "1" },
              DIR: { type: Scratch.ArgumentType.STRING, menu: "directionMenu", defaultValue: "RIGHT" },
              SECS: { type: Scratch.ArgumentType.NUMBER, defaultValue: 1 },
            },
          },
          {
            opcode: "setOutputState",
            blockType: Scratch.BlockType.COMMAND,
            text: "sortie [MOTOR] (lampe / vanne) sur [STATE]",
            arguments: {
              MOTOR: { type: Scratch.ArgumentType.STRING, menu: "motorMenu", defaultValue: "1" },
              STATE: { type: Scratch.ArgumentType.STRING, menu: "onOffMenu", defaultValue: "ON" },
            },
          },
          {
            opcode: "setOutputFromBoolean",
            blockType: Scratch.BlockType.COMMAND,
            text: "mettre la sortie [MOTOR] (lampe / vanne) à [COND]",
            arguments: {
              MOTOR: { type: Scratch.ArgumentType.STRING, menu: "motorMenu", defaultValue: "2" },
              COND: { type: Scratch.ArgumentType.BOOLEAN },
            },
          },
          {
            opcode: "blinkOutputWhileBoolean",
            blockType: Scratch.BlockType.COMMAND,
            text: "faire clignoter la sortie [MOTOR] tant que [COND] (rythme [SPEED])",
            arguments: {
              MOTOR: { type: Scratch.ArgumentType.STRING, menu: "motorMenu", defaultValue: "4" },
              COND: { type: Scratch.ArgumentType.BOOLEAN },
              SPEED: { type: Scratch.ArgumentType.STRING, menu: "blinkSpeedMenu", defaultValue: "NORMAL" },
            },
          },
          {
            opcode: "setOutputBlinkMode",
            blockType: Scratch.BlockType.COMMAND,
            text: "clignoteur sur la sortie [MOTOR] : [BLINK_MODE]",
            arguments: {
              MOTOR: { type: Scratch.ArgumentType.STRING, menu: "motorMenu", defaultValue: "4" },
              BLINK_MODE: { type: Scratch.ArgumentType.STRING, menu: "blinkModeMenu", defaultValue: "NORMAL" },
            },
          },
          {
            opcode: "isMotorRunning",
            blockType: Scratch.BlockType.BOOLEAN,
            text: "le moteur [MOTOR] tourne ?",
            arguments: {
              MOTOR: { type: Scratch.ArgumentType.STRING, menu: "motorMenu", defaultValue: "1" },
            },
          },
          {
            opcode: "stopMotor",
            blockType: Scratch.BlockType.COMMAND,
            text: "arrêter le moteur [MOTOR]",
            arguments: {
              MOTOR: { type: Scratch.ArgumentType.STRING, menu: "motorMenu", defaultValue: "1" },
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
            text: "🔘 Capteurs & Entrées (E1-E8, EX, EY)",
          },
          {
            opcode: "whenInputPressed",
            blockType: Scratch.BlockType.HAT,
            text: "quand l'entrée [INPUT] est [STATE]",
            arguments: {
              INPUT: { type: Scratch.ArgumentType.STRING, menu: "inputMenu", defaultValue: "E1" },
              STATE: { type: Scratch.ArgumentType.STRING, menu: "inputStateMenu", defaultValue: "PRESSED" },
            },
          },
          {
            opcode: "isInputActive",
            blockType: Scratch.BlockType.BOOLEAN,
            text: "l'entrée [INPUT] est pressée ?",
            arguments: {
              INPUT: { type: Scratch.ArgumentType.STRING, menu: "inputMenu", defaultValue: "E1" },
            },
          },
          {
            opcode: "getAnalogValue",
            blockType: Scratch.BlockType.REPORTER,
            text: "valeur analogique [CHANNEL]",
            arguments: {
              CHANNEL: { type: Scratch.ArgumentType.STRING, menu: "analogMenu", defaultValue: "EX" },
            },
          },
          {
            opcode: "getBinaryInputs",
            blockType: Scratch.BlockType.REPORTER,
            text: "octet des entrées E8..E1 (en binaire)",
          },
          "---",
          {
            blockType: Scratch.BlockType.LABEL,
            text: "🛠️ Modules Mécatroniques (Moteur + Capteurs)",
          },
          {
            opcode: "controlMotorTwoButtons",
            blockType: Scratch.BlockType.COMMAND,
            color1: COLOR_MECA_1,
            color2: COLOR_MECA_2,
            color3: COLOR_MECA_3,
            text: "piloter [MOTOR] avec boutons [BTN_R] (droite) et [BTN_L] (gauche)",
            arguments: {
              MOTOR: { type: Scratch.ArgumentType.STRING, menu: "motorMenu", defaultValue: "1" },
              BTN_R: { type: Scratch.ArgumentType.STRING, menu: "inputMenu", defaultValue: "E1" },
              BTN_L: { type: Scratch.ArgumentType.STRING, menu: "inputMenu", defaultValue: "E2" },
            },
          },
          {
            opcode: "controlMotorButtonsAndLimits",
            blockType: Scratch.BlockType.COMMAND,
            color1: COLOR_MECA_1,
            color2: COLOR_MECA_2,
            color3: COLOR_MECA_3,
            text: "piloter [MOTOR] boutons [BTN_R]/[BTN_L] avec fins de course [LIM_R]/[LIM_L]",
            arguments: {
              MOTOR: { type: Scratch.ArgumentType.STRING, menu: "motorMenu", defaultValue: "1" },
              BTN_R: { type: Scratch.ArgumentType.STRING, menu: "inputMenu", defaultValue: "E1" },
              BTN_L: { type: Scratch.ArgumentType.STRING, menu: "inputMenu", defaultValue: "E2" },
              LIM_R: { type: Scratch.ArgumentType.STRING, menu: "inputMenu", defaultValue: "E3" },
              LIM_L: { type: Scratch.ArgumentType.STRING, menu: "inputMenu", defaultValue: "E4" },
            },
          },
          {
            opcode: "runMotorUntilInput",
            blockType: Scratch.BlockType.COMMAND,
            color1: COLOR_MECA_1,
            color2: COLOR_MECA_2,
            color3: COLOR_MECA_3,
            text: "moteur [MOTOR] vers [DIR] jusqu'au capteur [INPUT] (max [TIMEOUT] s)",
            arguments: {
              MOTOR: { type: Scratch.ArgumentType.STRING, menu: "motorMenu", defaultValue: "1" },
              DIR: { type: Scratch.ArgumentType.STRING, menu: "directionMenu", defaultValue: "RIGHT" },
              INPUT: { type: Scratch.ArgumentType.STRING, menu: "inputMenu", defaultValue: "E1" },
              TIMEOUT: { type: Scratch.ArgumentType.NUMBER, defaultValue: 5 },
            },
          },
          {
            opcode: "runPistonCycle",
            blockType: Scratch.BlockType.COMMAND,
            color1: COLOR_MECA_1,
            color2: COLOR_MECA_2,
            color3: COLOR_MECA_3,
            text: "cycle aller-retour [MOTOR] : aller jusqu'à [IN_FWD] puis revenir à [IN_BACK] (pause [PAUSE] s)",
            arguments: {
              MOTOR: { type: Scratch.ArgumentType.STRING, menu: "motorMenu", defaultValue: "1" },
              IN_FWD: { type: Scratch.ArgumentType.STRING, menu: "inputMenu", defaultValue: "E5" },
              IN_BACK: { type: Scratch.ArgumentType.STRING, menu: "inputMenu", defaultValue: "E4" },
              PAUSE: { type: Scratch.ArgumentType.NUMBER, defaultValue: 0.5 },
            },
          },
          {
            opcode: "servoMotorToAnalog",
            blockType: Scratch.BlockType.COMMAND,
            color1: COLOR_MECA_1,
            color2: COLOR_MECA_2,
            color3: COLOR_MECA_3,
            text: "servomoteur : amener [MOTOR] à la position [CHANNEL] = [TARGET] (tolérance [TOL])",
            arguments: {
              MOTOR: { type: Scratch.ArgumentType.STRING, menu: "motorMenu", defaultValue: "1" },
              CHANNEL: { type: Scratch.ArgumentType.STRING, menu: "analogMenu", defaultValue: "EX" },
              TARGET: { type: Scratch.ArgumentType.NUMBER, defaultValue: 500 },
              TOL: { type: Scratch.ArgumentType.NUMBER, defaultValue: 25 },
            },
          },
          {
            opcode: "runMotorForPulses",
            blockType: Scratch.BlockType.COMMAND,
            color1: COLOR_MECA_1,
            color2: COLOR_MECA_2,
            color3: COLOR_MECA_3,
            text: "moteur [MOTOR] vers [DIR] pendant [PULSES] impulsions sur [INPUT]",
            arguments: {
              MOTOR: { type: Scratch.ArgumentType.STRING, menu: "motorMenu", defaultValue: "1" },
              DIR: { type: Scratch.ArgumentType.STRING, menu: "directionMenu", defaultValue: "RIGHT" },
              PULSES: { type: Scratch.ArgumentType.NUMBER, defaultValue: 5 },
              INPUT: { type: Scratch.ArgumentType.STRING, menu: "inputMenu", defaultValue: "E1" },
            },
          },
          {
            opcode: "getPulseCount",
            blockType: Scratch.BlockType.REPORTER,
            color1: COLOR_MECA_1,
            color2: COLOR_MECA_2,
            color3: COLOR_MECA_3,
            text: "compteur d'impulsions sur [INPUT]",
            arguments: {
              INPUT: { type: Scratch.ArgumentType.STRING, menu: "inputMenu", defaultValue: "E1" },
            },
          },
          {
            opcode: "resetPulseCount",
            blockType: Scratch.BlockType.COMMAND,
            color1: COLOR_MECA_1,
            color2: COLOR_MECA_2,
            color3: COLOR_MECA_3,
            text: "remettre à zéro le compteur d'impulsions [INPUT]",
            arguments: {
              INPUT: { type: Scratch.ArgumentType.STRING, menu: "inputMenu", defaultValue: "E1" },
            },
          },
          {
            opcode: "homeAxisLLWin",
            blockType: Scratch.BlockType.COMMAND,
            color1: COLOR_MECA_1,
            color2: COLOR_MECA_2,
            color3: COLOR_MECA_3,
            text: "prise d'origine axe [MOTOR] (sens [DIR] jusqu'à [LIMIT], codeur [ENCODER])",
            arguments: {
              MOTOR: { type: Scratch.ArgumentType.STRING, menu: "motorMenu", defaultValue: "1" },
              DIR: { type: Scratch.ArgumentType.STRING, menu: "directionMenu", defaultValue: "LEFT" },
              LIMIT: { type: Scratch.ArgumentType.STRING, menu: "inputMenu", defaultValue: "E2" },
              ENCODER: { type: Scratch.ArgumentType.STRING, menu: "inputMenu", defaultValue: "E1" },
            },
          },
          {
            opcode: "moveAxisToPulsePosition",
            blockType: Scratch.BlockType.COMMAND,
            color1: COLOR_MECA_1,
            color2: COLOR_MECA_2,
            color3: COLOR_MECA_3,
            text: "amener axe [MOTOR] (codeur [ENCODER]) à la position absolue [TARGET] impulsions",
            arguments: {
              MOTOR: { type: Scratch.ArgumentType.STRING, menu: "motorMenu", defaultValue: "1" },
              ENCODER: { type: Scratch.ArgumentType.STRING, menu: "inputMenu", defaultValue: "E1" },
              TARGET: { type: Scratch.ArgumentType.NUMBER, defaultValue: 10 },
            },
          },
          {
            opcode: "getAxisPulsePosition",
            blockType: Scratch.BlockType.REPORTER,
            color1: COLOR_MECA_1,
            color2: COLOR_MECA_2,
            color3: COLOR_MECA_3,
            text: "position absolue de l'axe [MOTOR] (en impulsions)",
            arguments: {
              MOTOR: { type: Scratch.ArgumentType.STRING, menu: "motorMenu", defaultValue: "1" },
            },
          },
          "---",
          {
            blockType: Scratch.BlockType.LABEL,
            text: "📈 Régulation & Serial Plotter",
          },
          {
            opcode: "toggleSerialPlotter",
            blockType: Scratch.BlockType.COMMAND,
            color1: COLOR_REG_1,
            color2: COLOR_REG_2,
            color3: COLOR_REG_3,
            text: "Moniteur & Traceur Série (Plotter) : [VISIBLE]",
            arguments: {
              VISIBLE: { type: Scratch.ArgumentType.STRING, menu: "showHideMenu", defaultValue: "SHOW" },
            },
          },
          {
            opcode: "setPlotterSetpoint",
            blockType: Scratch.BlockType.COMMAND,
            color1: COLOR_REG_1,
            color2: COLOR_REG_2,
            color3: COLOR_REG_3,
            text: "tracer la consigne [VAL] (tolérance ± [BAND]) sur le Plotter",
            arguments: {
              VAL: { type: Scratch.ArgumentType.NUMBER, defaultValue: 500 },
              BAND: { type: Scratch.ArgumentType.NUMBER, defaultValue: 25 },
            },
          },
          {
            opcode: "regulateThermostat",
            blockType: Scratch.BlockType.COMMAND,
            color1: COLOR_REG_1,
            color2: COLOR_REG_2,
            color3: COLOR_REG_3,
            text: "régulateur Thermostat (TOR) sur [MOTOR] : capteur [CHANNEL] consigne [TARGET] hystérésis [HYST]",
            arguments: {
              MOTOR: { type: Scratch.ArgumentType.STRING, menu: "motorMenu", defaultValue: "1" },
              CHANNEL: { type: Scratch.ArgumentType.STRING, menu: "analogMenu", defaultValue: "EX" },
              TARGET: { type: Scratch.ArgumentType.NUMBER, defaultValue: 500 },
              HYST: { type: Scratch.ArgumentType.NUMBER, defaultValue: 25 },
            },
          },
          {
            opcode: "regulateThreePoint",
            blockType: Scratch.BlockType.COMMAND,
            color1: COLOR_REG_1,
            color2: COLOR_REG_2,
            color3: COLOR_REG_3,
            text: "régulateur Position (3-Points) sur [MOTOR] : capteur [CHANNEL] consigne [TARGET] zone morte [DEADBAND]",
            arguments: {
              MOTOR: { type: Scratch.ArgumentType.STRING, menu: "motorMenu", defaultValue: "1" },
              CHANNEL: { type: Scratch.ArgumentType.STRING, menu: "analogMenu", defaultValue: "EX" },
              TARGET: { type: Scratch.ArgumentType.NUMBER, defaultValue: 500 },
              DEADBAND: { type: Scratch.ArgumentType.NUMBER, defaultValue: 20 },
            },
          },
          {
            opcode: "regulateMasterSlave",
            blockType: Scratch.BlockType.COMMAND,
            color1: COLOR_REG_1,
            color2: COLOR_REG_2,
            color3: COLOR_REG_3,
            text: "télémanipulateur : moteur [MOTOR] (capteur EX) recopie le volant EY (zone morte [DEADBAND])",
            arguments: {
              MOTOR: { type: Scratch.ArgumentType.STRING, menu: "motorMenu", defaultValue: "1" },
              DEADBAND: { type: Scratch.ArgumentType.NUMBER, defaultValue: 20 },
            },
          },
          "---",
          {
            blockType: Scratch.BlockType.LABEL,
            text: "🔮 Jumeau Numérique Prédictif (Industrie 4.0)",
          },
          {
            opcode: "runPredictiveTwinMove",
            blockType: Scratch.BlockType.COMMAND,
            color1: COLOR_REG_1,
            color2: COLOR_REG_2,
            color3: COLOR_REG_3,
            text: "déplacer [MOTOR] vers [DIR] jusqu'à [INPUT] avec surveillance prédictive",
            arguments: {
              MOTOR: { type: Scratch.ArgumentType.STRING, menu: "motorMenu", defaultValue: "1" },
              DIR: { type: Scratch.ArgumentType.STRING, menu: "directionMenu", defaultValue: "RIGHT" },
              INPUT: { type: Scratch.ArgumentType.STRING, menu: "inputMenu", defaultValue: "E2" },
            },
          },
          {
            opcode: "resetPredictiveTwin",
            blockType: Scratch.BlockType.COMMAND,
            color1: COLOR_REG_1,
            color2: COLOR_REG_2,
            color3: COLOR_REG_3,
            text: "réinitialiser l'apprentissage du Jumeau Numérique",
          },
          {
            opcode: "getTwinHealthScore",
            blockType: Scratch.BlockType.REPORTER,
            color1: COLOR_REG_1,
            color2: COLOR_REG_2,
            color3: COLOR_REG_3,
            text: "santé mécanique du Jumeau Numérique (%)",
          },
          {
            opcode: "getTwinDiagnostic",
            blockType: Scratch.BlockType.REPORTER,
            color1: COLOR_REG_1,
            color2: COLOR_REG_2,
            color3: COLOR_REG_3,
            text: "diagnostic prédictif (NOMINAL / FRICTION / BLOCAGE)",
          },
          "---",
          {
            blockType: Scratch.BlockType.LABEL,
            text: "📊 Automate Séquentiel (GRAFCET)",
          },
          {
            opcode: "whenGrafcetStep",
            blockType: Scratch.BlockType.HAT,
            color1: COLOR_GRAF_1,
            color2: COLOR_GRAF_2,
            color3: COLOR_GRAF_3,
            text: "quand le GRAFCET est à l'étape [STEP]",
            arguments: {
              STEP: { type: Scratch.ArgumentType.NUMBER, defaultValue: 0 },
            },
          },
          {
            opcode: "grafcetTransitionTo",
            blockType: Scratch.BlockType.COMMAND,
            color1: COLOR_GRAF_1,
            color2: COLOR_GRAF_2,
            color3: COLOR_GRAF_3,
            text: "si [COND] franchir la transition vers l'étape [NEXT_STEP]",
            arguments: {
              COND: { type: Scratch.ArgumentType.BOOLEAN },
              NEXT_STEP: { type: Scratch.ArgumentType.NUMBER, defaultValue: 1 },
            },
          },
          {
            opcode: "setGrafcetStep",
            blockType: Scratch.BlockType.COMMAND,
            color1: COLOR_GRAF_1,
            color2: COLOR_GRAF_2,
            color3: COLOR_GRAF_3,
            text: "initialiser le GRAFCET à l'étape [STEP] (et couper moteurs)",
            arguments: {
              STEP: { type: Scratch.ArgumentType.NUMBER, defaultValue: 0 },
            },
          },
          {
            opcode: "getGrafcetStep",
            blockType: Scratch.BlockType.REPORTER,
            color1: COLOR_GRAF_1,
            color2: COLOR_GRAF_2,
            color3: COLOR_GRAF_3,
            text: "étape active du GRAFCET",
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
            acceptReporters: true,
            items: [
              { text: "MARCHE", value: "ON" },
              { text: "ARRÊT", value: "OFF" },
            ],
          },
          blinkSpeedMenu: {
            acceptReporters: false,
            items: [
              { text: "normal (2 clign./s)", value: "NORMAL" },
              { text: "rapide (4 clign./s)", value: "FAST" },
              { text: "lent (1 clign./s)", value: "SLOW" },
            ],
          },
          blinkModeMenu: {
            acceptReporters: false,
            items: [
              { text: "CLIGNOTER (normal)", value: "NORMAL" },
              { text: "CLIGNOTER (rapide)", value: "FAST" },
              { text: "CLIGNOTER (lent)", value: "SLOW" },
              { text: "ARRÊT", value: "OFF" },
            ],
          },
          showHideMenu: {
            acceptReporters: false,
            items: [
              { text: "AFFICHER", value: "SHOW" },
              { text: "MASQUER", value: "HIDE" },
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
        return await navigator.serial.requestPort();
      } catch (err) {
        if (err.name === "NotFoundError") {
          return null;
        }
        return await this._showPermissionButtonOverlay();
      }
    }

    _showPermissionButtonOverlay() {
      return new Promise((resolve) => {
        const overlay = document.createElement("div");
        overlay.style.cssText = `
          position: fixed; inset: 0; background: rgba(15, 23, 42, 0.6);
          display: flex; align-items: center; justify-content: center; z-index: 999999;
          font-family: sans-serif;
        `;

        const card = document.createElement("div");
        card.style.cssText = `
          background: white; padding: 24px 32px; border-radius: 12px;
          box-shadow: 0 10px 30px rgba(0,0,0,0.3); text-align: center; max-width: 400px;
          border-top: 6px solid #2E6B9E;
        `;

        const title = document.createElement("h3");
        title.textContent = "Connexion fischertechnik 30 402";
        title.style.margin = "0 0 12px 0";

        const desc = document.createElement("p");
        desc.textContent =
          "Cliquez sur le bouton ci-dessous puis choisissez votre adaptateur USB-Série (ex: COM20) :";
        desc.style.cssText = "color: #444; font-size: 14px; margin-bottom: 20px;";

        const btn = document.createElement("button");
        btn.textContent = "🔌 Choisir le port série (COM)";
        btn.style.cssText = `
          background: #2E6B9E; color: white; border: none; padding: 12px 20px;
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
      if (this.isConnected) return;

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
      const now = performance.now();
      let byte = 0;
      for (let i = 0; i < 4; i++) {
        let state = this.motors[i];
        const period = this.blinkPeriodsMs[i];
        if (period > 0) {
          // Clignotement automatique non-bloquant (50% allumé, 50% éteint)
          const phaseOn = Math.floor(now / (period / 2)) % 2 === 0;
          state = phaseOn ? MOTOR_RIGHT : MOTOR_STOP;
        }
        byte |= (state & 0b11) << (i * 2);
      }
      return byte;
    }

    async _readBytesWithTimeout(expectedCount, timeoutMs = 150) {
      const buffer = new Uint8Array(expectedCount);
      let offset = 0;
      const startTime = performance.now();

      while (offset < expectedCount) {
        if (performance.now() - startTime > timeoutMs) {
          return null;
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
              const key = `E${i + 1}`;
              const current = Boolean(this.digitalByte & (1 << i));
              if (current && !this.prevInputs[key]) {
                this.pulseCounts[key] = (this.pulseCounts[key] || 0) + 1;
                const mappedMotor = this.encoderMap[key];
                if (mappedMotor !== undefined) {
                  const dir = this.motors[mappedMotor];
                  if (dir === MOTOR_LEFT) {
                    this.axisPositions[mappedMotor] -= 1;
                  } else {
                    this.axisPositions[mappedMotor] += 1;
                  }
                }
              }
              this.prevInputs[key] = current;
              this.inputs[key] = current;
            }
            this.analog[channel] = (resp[1] << 8) | resp[2];
          }
        } catch (err) {
          console.warn("Erreur de communication avec le 30 402 :", err);
          if (err.name === "NetworkError" || err.name === "InvalidStateError") {
            await this.disconnectPort();
            break;
          }
        }

        await new Promise((r) => setTimeout(r, 45));
      }
    }

    // --- Utilitaires internes ---

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

    _normalizeInputName(inputArg) {
      const str = String(inputArg).toUpperCase().trim();
      if (str.startsWith("E")) return str;
      const num = parseInt(str, 10);
      if (num >= 1 && num <= 8) return `E${num}`;
      return "E1";
    }

    // --- Blocs de Base ---

    isInterfaceConnected() {
      return this.isConnected;
    }

    setMotorDirection(args) {
      const idx = this._parseMotorIndex(args.MOTOR);
      this.blinkPeriodsMs[idx] = 0;
      this.motors[idx] = this._parseDirection(args.DIR);
    }

    async runMotorForSeconds(args) {
      const idx = this._parseMotorIndex(args.MOTOR);
      const dir = this._parseDirection(args.DIR);
      const secs = Math.max(0, Number(args.SECS) || 0);

      this.blinkPeriodsMs[idx] = 0;
      this.motors[idx] = dir;
      await new Promise((r) => setTimeout(r, secs * 1000));
      this.motors[idx] = MOTOR_STOP;
    }

    setOutputState(args) {
      const idx = this._parseMotorIndex(args.MOTOR);
      this.blinkPeriodsMs[idx] = 0;
      const state = String(args.STATE).toUpperCase().trim();
      const isOn =
        args.STATE === true ||
        state === "ON" ||
        state === "MARCHE" ||
        state === "TRUE" ||
        state === "VRAI" ||
        state === "1";
      this.motors[idx] = isOn ? MOTOR_RIGHT : MOTOR_STOP;
    }

    setOutputFromBoolean(args) {
      const idx = this._parseMotorIndex(args.MOTOR);
      this.blinkPeriodsMs[idx] = 0;
      this.motors[idx] = Boolean(args.COND) ? MOTOR_RIGHT : MOTOR_STOP;
    }

    _speedToPeriodMs(speedArg) {
      const s = String(speedArg).toUpperCase();
      if (s === "FAST" || s === "RAPIDE") return 250; // 4 Hz
      if (s === "SLOW" || s === "LENT") return 900;   // ~1 Hz
      return 480;                                     // ~2 Hz (Normal)
    }

    blinkOutputWhileBoolean(args) {
      const idx = this._parseMotorIndex(args.MOTOR);
      if (Boolean(args.COND)) {
        this.blinkPeriodsMs[idx] = this._speedToPeriodMs(args.SPEED);
      } else {
        this.blinkPeriodsMs[idx] = 0;
        this.motors[idx] = MOTOR_STOP;
      }
    }

    setOutputBlinkMode(args) {
      const idx = this._parseMotorIndex(args.MOTOR);
      const mode = String(args.BLINK_MODE).toUpperCase();
      if (mode === "OFF" || mode === "ARRET" || mode === "ARRÊT") {
        this.blinkPeriodsMs[idx] = 0;
        this.motors[idx] = MOTOR_STOP;
      } else {
        this.blinkPeriodsMs[idx] = this._speedToPeriodMs(mode);
      }
    }

    isMotorRunning(args) {
      const idx = this._parseMotorIndex(args.MOTOR);
      return this.motors[idx] !== MOTOR_STOP || this.blinkPeriodsMs[idx] > 0;
    }

    stopMotor(args) {
      const idx = this._parseMotorIndex(args.MOTOR);
      this.blinkPeriodsMs[idx] = 0;
      this.motors[idx] = MOTOR_STOP;
    }

    stopAllMotors() {
      this.blinkPeriodsMs = [0, 0, 0, 0];
      this.motors = [MOTOR_STOP, MOTOR_STOP, MOTOR_STOP, MOTOR_STOP];
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

    // --- Sous-groupe 1 : Modules Mécatroniques Combinés ---

    controlMotorTwoButtons(args) {
      const idx = this._parseMotorIndex(args.MOTOR);
      const btnR = Boolean(this.inputs[this._normalizeInputName(args.BTN_R)]);
      const btnL = Boolean(this.inputs[this._normalizeInputName(args.BTN_L)]);

      if (btnR && !btnL) {
        this.motors[idx] = MOTOR_RIGHT;
      } else if (btnL && !btnR) {
        this.motors[idx] = MOTOR_LEFT;
      } else {
        this.motors[idx] = MOTOR_STOP;
      }
    }

    controlMotorButtonsAndLimits(args) {
      const idx = this._parseMotorIndex(args.MOTOR);
      const btnR = Boolean(this.inputs[this._normalizeInputName(args.BTN_R)]);
      const btnL = Boolean(this.inputs[this._normalizeInputName(args.BTN_L)]);
      const limR = Boolean(this.inputs[this._normalizeInputName(args.LIM_R)]);
      const limL = Boolean(this.inputs[this._normalizeInputName(args.LIM_L)]);

      if (btnR && !btnL && !limR) {
        this.motors[idx] = MOTOR_RIGHT;
      } else if (btnL && !btnR && !limL) {
        this.motors[idx] = MOTOR_LEFT;
      } else {
        this.motors[idx] = MOTOR_STOP;
      }
    }

    async runMotorUntilInput(args) {
      const idx = this._parseMotorIndex(args.MOTOR);
      const dir = this._parseDirection(args.DIR);
      const key = this._normalizeInputName(args.INPUT);
      const timeoutMs = Math.max(0.2, Number(args.TIMEOUT) || 5) * 1000;

      const start = performance.now();
      this.motors[idx] = dir;

      while (!this.inputs[key] && performance.now() - start < timeoutMs) {
        await new Promise((r) => setTimeout(r, 25));
      }

      this.motors[idx] = MOTOR_STOP;
    }

    async runPistonCycle(args) {
      const idx = this._parseMotorIndex(args.MOTOR);
      const inFwd = this._normalizeInputName(args.IN_FWD);
      const inBack = this._normalizeInputName(args.IN_BACK);
      const pauseMs = Math.max(0, Number(args.PAUSE) || 0.5) * 1000;

      let start = performance.now();
      this.motors[idx] = MOTOR_RIGHT;
      while (!this.inputs[inFwd] && performance.now() - start < 8000) {
        await new Promise((r) => setTimeout(r, 25));
      }
      this.motors[idx] = MOTOR_STOP;

      if (pauseMs > 0) {
        await new Promise((r) => setTimeout(r, pauseMs));
      }

      start = performance.now();
      this.motors[idx] = MOTOR_LEFT;
      while (!this.inputs[inBack] && performance.now() - start < 8000) {
        await new Promise((r) => setTimeout(r, 25));
      }
      this.motors[idx] = MOTOR_STOP;
    }

    async servoMotorToAnalog(args) {
      const idx = this._parseMotorIndex(args.MOTOR);
      const ch = String(args.CHANNEL).toUpperCase().trim() === "EY" ? "EY" : "EX";
      const target = Math.min(1000, Math.max(0, Number(args.TARGET) || 500));
      const tol = Math.max(5, Number(args.TOL) || 25);

      this.plotterSetpoint = target;
      this.plotterBand = tol;

      const start = performance.now();
      while (performance.now() - start < 8000) {
        const current = this.analog[ch];
        const error = target - current;
        if (Math.abs(error) <= tol) {
          break;
        }
        this.motors[idx] = error > 0 ? MOTOR_RIGHT : MOTOR_LEFT;
        await new Promise((r) => setTimeout(r, 35));
      }
      this.motors[idx] = MOTOR_STOP;
    }

    async runMotorForPulses(args) {
      const idx = this._parseMotorIndex(args.MOTOR);
      const dir = this._parseDirection(args.DIR);
      const key = this._normalizeInputName(args.INPUT);
      const targetPulses = Math.max(1, Math.round(Number(args.PULSES) || 1));

      const initialCount = this.pulseCounts[key] || 0;
      const start = performance.now();
      this.motors[idx] = dir;

      while (
        (this.pulseCounts[key] || 0) - initialCount < targetPulses &&
        performance.now() - start < 15000
      ) {
        await new Promise((r) => setTimeout(r, 25));
      }

      this.motors[idx] = MOTOR_STOP;
    }

    getPulseCount(args) {
      const key = this._normalizeInputName(args.INPUT);
      return this.pulseCounts[key] || 0;
    }

    resetPulseCount(args) {
      const key = this._normalizeInputName(args.INPUT);
      this.pulseCounts[key] = 0;
    }

    async homeAxisLLWin(args) {
      const idx = this._parseMotorIndex(args.MOTOR);
      const dir = this._parseDirection(args.DIR);
      const limitKey = this._normalizeInputName(args.LIMIT);
      const encKey = this._normalizeInputName(args.ENCODER);

      this.encoderMap[encKey] = idx;
      const start = performance.now();
      this.motors[idx] = dir;
      while (!this.inputs[limitKey] && performance.now() - start < 10000) {
        await new Promise((r) => setTimeout(r, 25));
      }
      this.motors[idx] = MOTOR_STOP;
      this.axisPositions[idx] = 0;
      this.pulseCounts[encKey] = 0;
    }

    async moveAxisToPulsePosition(args) {
      const idx = this._parseMotorIndex(args.MOTOR);
      const encKey = this._normalizeInputName(args.ENCODER);
      const target = Math.round(Number(args.TARGET) || 0);

      this.encoderMap[encKey] = idx;
      const start = performance.now();
      while (performance.now() - start < 15000) {
        const err = target - (this.axisPositions[idx] || 0);
        if (err === 0) break;
        this.motors[idx] = err > 0 ? MOTOR_RIGHT : MOTOR_LEFT;
        await new Promise((r) => setTimeout(r, 25));
      }
      this.motors[idx] = MOTOR_STOP;
    }

    getAxisPulsePosition(args) {
      const idx = this._parseMotorIndex(args.MOTOR);
      return this.axisPositions[idx] || 0;
    }

    // --- Sous-groupe 2 : Régulation & Serial Plotter ---

    toggleSerialPlotter(args) {
      const show = String(args.VISIBLE).toUpperCase() === "SHOW";
      if (show) {
        this._createPlotterWidget();
      } else {
        this._destroyPlotterWidget();
      }
    }

    setPlotterSetpoint(args) {
      this.plotterSetpoint = Math.min(1000, Math.max(0, Number(args.VAL) || 500));
      this.plotterBand = Math.max(0, Number(args.BAND) || 25);
    }

    regulateThermostat(args) {
      const idx = this._parseMotorIndex(args.MOTOR);
      const ch = String(args.CHANNEL).toUpperCase().trim() === "EY" ? "EY" : "EX";
      const target = Math.min(1000, Math.max(0, Number(args.TARGET) || 500));
      const hyst = Math.max(5, Number(args.HYST) || 25);

      this.plotterSetpoint = target;
      this.plotterBand = hyst;

      const mesure = this.analog[ch];
      if (mesure < target - hyst) {
        this.thermostatStates[idx] = true;
      } else if (mesure > target + hyst) {
        this.thermostatStates[idx] = false;
      }
      this.motors[idx] = this.thermostatStates[idx] ? MOTOR_RIGHT : MOTOR_STOP;
    }

    regulateThreePoint(args) {
      const idx = this._parseMotorIndex(args.MOTOR);
      const ch = String(args.CHANNEL).toUpperCase().trim() === "EY" ? "EY" : "EX";
      const target = Math.min(1000, Math.max(0, Number(args.TARGET) || 500));
      const deadband = Math.max(5, Number(args.DEADBAND) || 20);

      this.plotterSetpoint = target;
      this.plotterBand = deadband;

      const error = target - this.analog[ch];
      if (error > deadband) {
        this.motors[idx] = MOTOR_RIGHT;
      } else if (error < -deadband) {
        this.motors[idx] = MOTOR_LEFT;
      } else {
        this.motors[idx] = MOTOR_STOP;
      }
    }

    regulateMasterSlave(args) {
      const idx = this._parseMotorIndex(args.MOTOR);
      const deadband = Math.max(5, Number(args.DEADBAND) || 20);
      const target = this.analog.EY;
      const mesure = this.analog.EX;

      this.plotterSetpoint = target;
      this.plotterBand = deadband;

      const error = target - mesure;
      if (error > deadband) {
        this.motors[idx] = MOTOR_RIGHT;
      } else if (error < -deadband) {
        this.motors[idx] = MOTOR_LEFT;
      } else {
        this.motors[idx] = MOTOR_STOP;
      }
    }

    _pushPlotterSample() {
      this.history.push({
        ex: this.analog.EX,
        ey: this.analog.EY,
        sp: this.plotterSetpoint,
        band: this.plotterBand,
        m1: this.motors[0],
      });
      if (this.history.length > this.maxHistory) {
        this.history.shift();
      }
    }

    _createPlotterWidget() {
      if (this.plotterPanel) return;

      const panel = document.createElement("div");
      panel.style.cssText = `
        position: fixed; right: 18px; bottom: 18px; width: 410px;
        background: #0f172a; color: #f8fafc; border-radius: 10px;
        box-shadow: 0 12px 32px rgba(0,0,0,0.45); border: 2px solid #334155;
        font-family: 'Segoe UI', Consolas, sans-serif; z-index: 999990;
        overflow: hidden; user-select: none;
      `;

      // Barre de titre déplaçable à la souris
      const header = document.createElement("div");
      header.style.cssText = `
        background: #1e293b; padding: 7px 12px; display: flex;
        justify-content: space-between; align-items: center; cursor: move;
        border-bottom: 1px solid #334155; font-size: 12.5px; font-weight: bold;
      `;
      header.innerHTML = `<span>📈 Serial Monitor &amp; Plotter (30 402)</span>`;

      const controls = document.createElement("div");
      controls.style.cssText = "display:flex; gap:6px;";

      const pauseBtn = document.createElement("button");
      pauseBtn.textContent = "⏸ Pause";
      pauseBtn.style.cssText = `
        background: #334155; color: white; border: none; padding: 2px 8px;
        border-radius: 4px; font-size: 11px; cursor: pointer;
      `;
      pauseBtn.onclick = () => {
        this.plotterPaused = !this.plotterPaused;
        pauseBtn.textContent = this.plotterPaused ? "▶️ Reprendre" : "⏸ Pause";
      };

      const closeBtn = document.createElement("button");
      closeBtn.textContent = "✖";
      closeBtn.style.cssText = `
        background: #dc2626; color: white; border: none; padding: 2px 7px;
        border-radius: 4px; font-size: 11px; cursor: pointer;
      `;
      closeBtn.onclick = () => this._destroyPlotterWidget();

      controls.appendChild(pauseBtn);
      controls.appendChild(closeBtn);
      header.appendChild(controls);

      // Légende des courbes
      const legend = document.createElement("div");
      legend.style.cssText = `
        display: flex; justify-content: space-around; padding: 5px 8px;
        font-size: 11px; background: #090d16; border-bottom: 1px solid #1e293b;
      `;
      legend.innerHTML = `
        <span style="color:#4ade80; font-weight:bold;">● EX (Mesure)</span>
        <span style="color:#fb923c; font-weight:bold;">● EY</span>
        <span style="color:#38bdf8; font-weight:bold;">--- Consigne (±Tol)</span>
      `;

      // Canvas Oscilloscope
      const canvas = document.createElement("canvas");
      canvas.width = 406;
      canvas.height = 155;
      canvas.style.cssText = "display: block; background: #090d16;";

      // Zone Serial Monitor (texte temps réel)
      const monitor = document.createElement("div");
      monitor.style.cssText = `
        padding: 7px 10px; font-family: Consolas, monospace; font-size: 11px;
        background: #1e293b; color: #cbd5e1; line-height: 1.45;
      `;

      panel.appendChild(header);
      panel.appendChild(legend);
      panel.appendChild(canvas);
      panel.appendChild(monitor);
      document.body.appendChild(panel);

      // Drag & Drop de la fenêtre
      let dragging = false, offsetX = 0, offsetY = 0;
      header.addEventListener("mousedown", (e) => {
        dragging = true;
        const rect = panel.getBoundingClientRect();
        offsetX = e.clientX - rect.left;
        offsetY = e.clientY - rect.top;
      });
      window.addEventListener("mousemove", (e) => {
        if (!dragging) return;
        panel.style.left = `${Math.max(0, e.clientX - offsetX)}px`;
        panel.style.top = `${Math.max(0, e.clientY - offsetY)}px`;
        panel.style.right = "auto";
        panel.style.bottom = "auto";
      });
      window.addEventListener("mouseup", () => { dragging = false; });

      this.plotterPanel = panel;
      this.plotterCanvas = canvas;
      this.monitorLogEl = monitor;
    }

    _destroyPlotterWidget() {
      if (this.plotterPanel && this.plotterPanel.parentNode) {
        this.plotterPanel.parentNode.removeChild(this.plotterPanel);
      }
      this.plotterPanel = null;
      this.plotterCanvas = null;
      this.monitorLogEl = null;
    }

    _renderPlotterWidget() {
      if (!this.plotterCanvas || !this.monitorLogEl) return;
      const ctx = this.plotterCanvas.getContext("2d");
      const w = this.plotterCanvas.width;
      const h = this.plotterCanvas.height;

      ctx.clearRect(0, 0, w, h);

      // Grille horizontale (0, 250, 500, 750, 1000)
      ctx.strokeStyle = "#1e293b";
      ctx.lineWidth = 1;
      [0.25, 0.5, 0.75].forEach((ratio) => {
        const y = h * ratio;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
      });

      const yOf = (val) => h - (Math.min(1000, Math.max(0, val)) / 1000) * (h - 14) - 7;

      // Tunnel d'hystérésis / zone morte autour de la consigne
      const spY = yOf(this.plotterSetpoint);
      const topY = yOf(this.plotterSetpoint + this.plotterBand);
      const botY = yOf(this.plotterSetpoint - this.plotterBand);

      ctx.fillStyle = "rgba(56, 189, 248, 0.10)";
      ctx.fillRect(0, topY, w, botY - topY);

      // Ligne de Consigne (bleu pointillé)
      ctx.strokeStyle = "#38bdf8";
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      ctx.moveTo(0, spY);
      ctx.lineTo(w, spY);
      ctx.stroke();
      ctx.setLineDash([]);

      if (this.history.length > 1) {
        const stepX = w / (this.maxHistory - 1);

        // Courbe EY (Orange)
        ctx.strokeStyle = "#fb923c";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        this.history.forEach((pt, i) => {
          const x = i * stepX;
          const y = yOf(pt.ey);
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        });
        ctx.stroke();

        // Courbe EX (Vert vif)
        ctx.strokeStyle = "#4ade80";
        ctx.lineWidth = 2.2;
        ctx.beginPath();
        this.history.forEach((pt, i) => {
          const x = i * stepX;
          const y = yOf(pt.ex);
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        });
        ctx.stroke();
      }

      // Mise à jour du Serial Monitor texte en bas du widget
      const mByte = this._buildMotorByte();
      const err = this.plotterSetpoint - this.analog.EX;
      this.monitorLogEl.innerHTML =
        `<div><b>EX:</b> <span style="color:#4ade80">${String(this.analog.EX).padStart(4, " ")}</span> | ` +
        `<b>EY:</b> <span style="color:#fb923c">${String(this.analog.EY).padStart(4, " ")}</span> | ` +
        `<b>Consigne:</b> <span style="color:#38bdf8">${this.plotterSetpoint}</span> (Err: ${err > 0 ? "+" + err : err})</div>` +
        `<div><b>TX:</b> [0xC5, 0b${mByte.toString(2).padStart(8, "0")}] | ` +
        `<b>RX E8..E1:</b> [0b${this.digitalByte.toString(2).padStart(8, "0")}]</div>`;
    }

    // --- Sous-groupe 3 : Automate Séquentiel GRAFCET ---

    whenGrafcetStep(args) {
      return this.grafcetStep === Number(args.STEP);
    }

    grafcetTransitionTo(args) {
      if (Boolean(args.COND)) {
        this.stopAllMotors();
        this.grafcetStep = Number(args.NEXT_STEP);
      }
    }

    setGrafcetStep(args) {
      this.stopAllMotors();
      this.grafcetStep = Number(args.STEP) || 0;
    }

    getGrafcetStep() {
      return this.grafcetStep;
    }

    // --- Sous-groupe 4 : Jumeau Numérique Prédictif (Maintenance Prédictive 4.0) ---

    async runPredictiveTwinMove(args) {
      const idx = this._parseMotorIndex(args.MOTOR);
      const dir = this._parseDirection(args.DIR);
      const key = this._normalizeInputName(args.INPUT);
      const moveId = `M${idx + 1}_${dir}_${key}`;

      const baseline = this.twinBaselineMs[moveId];
      // Si déjà calibré, coupe automatiquement à 160 % du temps nominal (Auto-Trip anti-casse)
      const maxAllowedMs = baseline ? Math.max(800, baseline * 1.6) : 8000;

      const start = performance.now();
      this.motors[idx] = dir;

      let jammed = false;
      while (!this.inputs[key]) {
        if (performance.now() - start >= maxAllowedMs) {
          jammed = true;
          break;
        }
        await new Promise((r) => setTimeout(r, 20));
      }
      this.motors[idx] = MOTOR_STOP;
      const elapsed = performance.now() - start;

      if (jammed) {
        this.twinHealthScore = 0;
        this.twinDiagnostic = "BLOCAGE CRITIQUE";
      } else if (!baseline) {
        this.twinBaselineMs[moveId] = elapsed;
        this.twinHealthScore = 100;
        this.twinDiagnostic = `CALIBRÉ (${Math.round(elapsed)} ms)`;
      } else {
        const driftPct = ((elapsed - baseline) / baseline) * 100;
        this.twinHealthScore = Math.max(0, Math.min(100, Math.round(100 - Math.max(0, driftPct) * 1.5)));
        if (driftPct > 25) {
          this.twinDiagnostic = `FRICTION (+${Math.round(driftPct)}%)`;
        } else if (driftPct < -25) {
          this.twinDiagnostic = `GLISSEMENT (${Math.round(driftPct)}%)`;
        } else {
          this.twinDiagnostic = `NOMINAL (${driftPct >= 0 ? "+" : ""}${Math.round(driftPct)}%)`;
        }
      }
    }

    resetPredictiveTwin() {
      this.twinBaselineMs = {};
      this.twinHealthScore = 100;
      this.twinDiagnostic = "CALIBRATION";
    }

    getTwinHealthScore() {
      return this.twinHealthScore;
    }

    getTwinDiagnostic() {
      return this.twinDiagnostic;
    }
  }

  Scratch.extensions.register(new Fischertechnik30402Extension());
})(Scratch);
