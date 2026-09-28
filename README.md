# Raumübersicht für Home Assistant

Eine Dashboard-Karte, die alle Räume auf einen Blick zeigt. Ein Tipp auf einen Raum öffnet ein Popup mit allen Geräten des Raums, nach Kategorien sortiert. Passt zur Integration [Smart Ventilation](https://github.com/patrickbrundiers-dev/smart_ventilation).

Die Karte liest Räume und Geräte selbst aus den **Bereichen (Areas)** von Home Assistant. Du musst keine Entity-IDs eintragen.

## Was sie zeigt

**Kopfzeile**
- Wischbare Chip-Zeile: Wetter, Außentemperatur, Winter- oder Sommer-Modus, "1 Fenster offen", "1 Raum zu feucht", "Heizung in 4 von 5 Räumen an", Gesamtverbrauch
- Karte "Dringendster Raum" mit Grund, zum Beispiel "Bad: zu feucht, Feuchte 71 %". Ein Tipp öffnet das Popup des Raums

**Raumkarte** (ein Raum pro Zeile)
- Kopf mit Raumname und Fensterstatus ("geschlossen" oder "offen seit 4 Min")
- Große Temperatur mit 24-Stunden-Verlauf
- Luftfeuchte mit farbiger Skala (gelb, grün, gelb, rot von 20 bis 80 %) und Marker als Schimmel-Ampel
- Heizung mit Zieltemperatur, Minus, Plus und Aus/Heizen direkt auf der Karte
- Aktueller Stromverbrauch des Raums, falls Leistungssensoren im Bereich liegen
- Lüftungsempfehlung von Smart Ventilation, falls vorhanden, mit optionalem Ansagen-Button für Alexa
- Sortierung nach Dringlichkeit: Räume mit offenem Fenster, hoher Feuchte oder Lüftungsempfehlung stehen oben und bekommen einen farbigen Rand

**Popup pro Raum**
- Sortiert nach täglicher Nutzung: Heizung, Licht, Rollos, Steckdosen, Medien, Fenster und Bewegung, Raumklima
- Eingeschaltete Geräte stehen in jeder Kategorie oben
- Oben eine Live-Zeile mit Temperatur, Luftfeuchte und Heizung
- Bei den Sensoren nur das Nötige: Fenster- und Türkontakte, Bewegung, Anwesenheit, Rauch, Wasser sowie CO₂ und Luftqualität. Temperatur und Feuchte stehen schon oben und im Verlauf
- Technik wird nie angezeigt: Batterie, Spannung, Signalstärke, zweite Temperaturfühler der Heizkörper, Kindersicherung, Fenstererkennung der Thermostate und ähnliches
- Licht und Schalter direkt umschaltbar, Tipp auf ein Gerät öffnet die Detailansicht
- Buttons "Alles aus" und "Licht an" für alle Lichter des Raums
- Fenster und Türen zeigen, seit wann sie offen oder geschlossen sind
- Verlauf der letzten 7 Tage für Temperatur und Luftfeuchte
- Energie: aktueller Verbrauch und Tagesverbrauch (aus Energiesensoren mit Langzeitstatistik)
- Diagnose- und versteckte Entitäten werden ausgeblendet

## Installation über HACS

1. HACS öffnen, oben rechts ⋮, **Benutzerdefinierte Repositories**.
2. Repository `https://github.com/patrickbrundiers-dev/raum-bersicht-` eintragen, Typ **Dashboard**, hinzufügen.
3. **Raumübersicht** in HACS herunterladen.
4. Browser neu laden (Strg + F5) oder in der App den Frontend-Cache zurücksetzen.

HACS legt die Ressource automatisch an. Falls nicht: Einstellungen, Dashboards, ⋮, Ressourcen, `/hacsfiles/raum-bersicht-/raum-uebersicht-card.js` als JavaScript-Modul hinzufügen.

## Verwendung

Karte hinzufügen und **Raumübersicht** suchen, oder per YAML:

```yaml
type: custom:raum-uebersicht-card
```

Damit erscheinen alle Bereiche, die einen Temperatursensor oder ein Thermostat haben.

### Optionen

```yaml
type: custom:raum-uebersicht-card
title: Räume
columns: 1
more_sensors: false        # true zeigt übrige Sensoren eingeklappt am Ende des Popups
hide:                      # Entitäten ausblenden, ein Teil der ID genügt
  - sensor.beispiel
sort: urgency               # urgency (Standard), name oder config
announce:                   # optional: Lüftungsempfehlung per Alexa ansagen
  service: notify.alexa_media
  targets:
    - media_player.echo_wohnzimmer
  type: announce
rooms:
  - Schlafzimmer            # Kurzform: Name oder ID des Bereichs
  - area: Wohnzimmer
    name: Wohnzimmer unten  # optionaler Anzeigename
    icon: mdi:sofa
  - area: Bad
    temperature: sensor.bad_temperatur   # automatische Erkennung übersteuern
    humidity: sensor.bad_luftfeuchtigkeit
    window: binary_sensor.bad_fenster
    climate: climate.bad
    ventilation: sensor.bad_empfehlung
```

| Option | Bedeutung |
| --- | --- |
| `title` | Überschrift über den Karten |
| `columns` | Räume pro Zeile, Standard 1 |
| `more_sensors` | `true` zeigt die übrigen Sensoren eingeklappt am Ende des Popups, Standard aus |
| `hide` | Liste von Text-Teilen. Entitäten, deren ID einen davon enthält, verschwinden aus dem Popup und bei "Alles aus" |
| `rooms` | Auswahl der Räume, Standard alle passenden Bereiche |
| `summary` | `false` blendet Chip-Zeile und "Dringendster Raum" aus |
| `hero` | `false` blendet nur die Karte "Dringendster Raum" aus |
| `weather` | Wetter-Entität für das Chip, Standard die erste `weather.*`-Entität |
| `outdoor` | Außentemperatur-Sensor für das Chip "Draußen", zum Beispiel `sensor.aussentemperatur` |
| `season` | Sensor für Sommer/Winter-Modus. Wird automatisch gefunden, wenn ein Sensor mit "modus" in der ID den Zustand Winter oder Sommer hat |
| `all_off` | Welche Geräte "Alles aus" ausschaltet, Standard nur `[light]`. "Licht an" schaltet immer nur Lichter ein. Mit `[light, switch]` kommen Steckdosen dazu, Kühlschrank, Gefrierschrank, Router, NAS, Server und Alarm bleiben aber immer an. `false` blendet den Button aus |
| `exclude` | Räume ausblenden, zum Beispiel `[Balkon]`. Sie zählen dann auch nicht bei "zu feucht" |
| `show_unavailable` | `true` zeigt auch nicht erreichbare Geräte im Popup, Standard aus |
| `media` | `always` zeigt Lautsprecher auch im Leerlauf, Standard nur bei Wiedergabe oder Pause |
| `sort` | `urgency` (Dringendes zuerst), `name` (alphabetisch) oder `config` (Reihenfolge aus `rooms`) |
| `announce` | Alexa-Ansage, auch pro Raum in `rooms` setzbar. Der Button erscheint nur, wenn ein Raum eine Lüftungsempfehlung hat. Gesprochen wird "Raumname. Empfehlung" |

### Dringlichkeit

Ein offenes Fenster zählt am meisten, danach Feuchte ab 70 %, dann Feuchte ab 60 % und zuletzt eine Lüftungsempfehlung. Roter Rand steht für Fenster offen oder Feuchte über 70 %, gelber Rand für erhöhte Feuchte oder Lüftungsempfehlung.

### Raumseite statt Übersicht

Für die Unterseite eines einzelnen Raums zeigt `room:` die Raumkarte und darunter alle Geräte, Fenster, Verlauf und Energie ohne Popup:

```yaml
type: custom:raum-uebersicht-card
room:
  area: wohnzimmer
  window: binary_sensor.fenster_wohnzimmer   # optional, zum Beispiel eine Fenstergruppe
```

Unter `room` funktionieren dieselben Überschreibungen wie bei `rooms` (`temperature`, `humidity`, `window`, `climate`, `ventilation`, `name`, `icon`, `announce`). Angegebene Entitäten werden auch dann angezeigt, wenn sie keinem Bereich zugeordnet sind. Ein vollständiges Beispiel liegt in `examples/wohnzimmer.yaml`. Fenstergruppen ohne Geräteklasse werden am Namen erkannt (Fenster, Window, Tür, Door).

### Automatische Erkennung

| Anzeige | Gefunden über |
| --- | --- |
| Temperatur, Feuchte | Sensor mit Geräteklasse `temperature` bzw. `humidity` im Bereich. Abgeleitete Werte wie Taupunkt, Frostpunkt, Hitzeindex, Humidex, Simmer-Index und absolute Feuchte werden übersprungen, ebenso Sensoren der Integration Thermal Comfort. Heizkörper-Fühler nur als letzte Wahl |
| Fenster | Binärsensor mit Geräteklasse Fenster, Öffnung oder Tür. Fenstererkennung der Thermostate wird ignoriert |
| Heizung | das Better Thermostat des Raums. Weitere Thermostate, Gruppen oder Einzelheizkörper im selben Bereich werden nicht angezeigt. Gibt es kein Better Thermostat, wird die erste `climate`-Entität genommen |
| Lüften | Sensor im Bereich, dessen ID auf `_empfehlung` endet |

Voraussetzung ist, dass Geräte einem Bereich zugeordnet sind, entweder das Gerät selbst oder die einzelne Entität.

## Alternative ohne HACS-Karte

In `examples/` liegen zwei YAML-Dashboards, die stattdessen Standardkarten sowie Bubble Card und auto-entities nutzen. Die Entity-IDs darin sind Platzhalter.

## Status

Version 2.5.0. Die Logik ist mit simulierten Home-Assistant-Daten geprüft, aber noch nicht in einer echten Installation getestet. Rückmeldungen und Screenshots helfen.
