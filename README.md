# Raumübersicht für Home Assistant

Eine Dashboard-Karte, die alle Räume auf einen Blick zeigt. Ein Tipp auf einen Raum öffnet ein Popup mit allen Geräten des Raums, nach Kategorien sortiert. Passt zur Integration [Smart Ventilation](https://github.com/patrickbrundiers-dev/smart_ventilation).

Die Karte liest Räume und Geräte selbst aus den **Bereichen (Areas)** von Home Assistant. Du musst keine Entity-IDs eintragen.

## Was sie zeigt

**Zusammenfassung oben**
- Eine Zeile wie "1 Fenster offen, 1 Raum zu feucht, Heizung in 4 von 5 Räumen an, 240 W" oder "Alles in Ordnung"

**Raumkarte**
- Temperatur, Luftfeuchte (grün, gelb, rot als Schimmel-Ampel) und Fensterstatus mit Dauer
- Heizung mit Solltemperatur, Plus/Minus-Tasten und Ein/Aus-Taste direkt auf der Karte
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
- Button "Alles aus" schaltet alle eingeschalteten Lichter und Steckdosen des Raums aus
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
| `summary` | `false` blendet die Zusammenfassung oben aus |
| `all_off` | Welche Geräte "Alles aus" ausschaltet, Standard nur `[light]`. Mit `[light, switch]` kommen Steckdosen dazu, Kühlschrank, Gefrierschrank, Router, NAS, Server und Alarm bleiben aber immer an. `false` blendet den Button aus |
| `exclude` | Räume ausblenden, zum Beispiel `[Balkon]`. Sie zählen dann auch nicht bei "zu feucht" |
| `show_unavailable` | `true` zeigt auch nicht erreichbare Geräte im Popup, Standard aus |
| `media` | `always` zeigt Lautsprecher auch im Leerlauf, Standard nur bei Wiedergabe oder Pause |
| `sort` | `urgency` (Dringendes zuerst), `name` (alphabetisch) oder `config` (Reihenfolge aus `rooms`) |
| `announce` | Alexa-Ansage, auch pro Raum in `rooms` setzbar. Der Button erscheint nur, wenn ein Raum eine Lüftungsempfehlung hat. Gesprochen wird "Raumname. Empfehlung" |

### Dringlichkeit

Ein offenes Fenster zählt am meisten, danach Feuchte ab 70 %, dann Feuchte ab 60 % und zuletzt eine Lüftungsempfehlung. Roter Rand steht für Fenster offen oder Feuchte über 70 %, gelber Rand für erhöhte Feuchte oder Lüftungsempfehlung.

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

Version 2.3.0. Die Logik ist mit simulierten Home-Assistant-Daten geprüft, aber noch nicht in einer echten Installation getestet. Rückmeldungen und Screenshots helfen.
