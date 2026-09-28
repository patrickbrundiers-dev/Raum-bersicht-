# Raumübersicht für Home Assistant

Eine Dashboard-Karte, die alle Räume auf einen Blick zeigt. Ein Tipp auf einen Raum öffnet ein Popup mit allen Geräten des Raums, nach Kategorien sortiert. Passt zur Integration [Smart Ventilation](https://github.com/patrickbrundiers-dev/smart_ventilation).

Die Karte liest Räume und Geräte selbst aus den **Bereichen (Areas)** von Home Assistant. Du musst keine Entity-IDs eintragen.

## Was sie zeigt

**Raumkarte**
- Temperatur, Luftfeuchte (grün, gelb, rot als Schimmel-Ampel) und Fensterstatus mit Dauer
- Heizung mit Solltemperatur
- Lüftungsempfehlung von Smart Ventilation, falls vorhanden

**Popup pro Raum**
- Heizung und Klima, Licht, Steckdosen und Schalter, Rollos, Medien, Sensoren, Kontakte
- Licht und Schalter direkt umschaltbar, Tipp auf ein Gerät öffnet die Detailansicht
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
columns: 2
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
| `columns` | Karten pro Zeile, Standard 2 |
| `rooms` | Reihenfolge und Auswahl der Räume, Standard alle passenden Bereiche |

### Automatische Erkennung

| Anzeige | Gefunden über |
| --- | --- |
| Temperatur, Feuchte | Sensor mit Geräteklasse `temperature` bzw. `humidity` im Bereich |
| Fenster | Binärsensor mit Geräteklasse Fenster, Tür oder Öffnung |
| Heizung | erste `climate`-Entität im Bereich |
| Lüften | Sensor im Bereich, dessen ID auf `_empfehlung` endet |

Voraussetzung ist, dass Geräte einem Bereich zugeordnet sind, entweder das Gerät selbst oder die einzelne Entität.

## Alternative ohne HACS-Karte

In `examples/` liegen zwei YAML-Dashboards, die stattdessen Standardkarten sowie Bubble Card und auto-entities nutzen. Die Entity-IDs darin sind Platzhalter.

## Status

Version 1.0.0. Die Logik ist mit simulierten Home-Assistant-Daten geprüft, aber noch nicht in einer echten Installation getestet. Rückmeldungen und Screenshots helfen.
