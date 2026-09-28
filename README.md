# Raumübersicht für Home Assistant

Modernes Dashboard mit Raumübersicht und Geräte-Popups für Home Assistant. Passt zur Integration [Smart Ventilation](https://github.com/patrickbrundiers-dev/smart_ventilation).

## Inhalt

| Datei | Zweck |
| --- | --- |
| `dashboards/raumuebersicht.yaml` | Ansicht im Sections-Layout mit einer Karte pro Raum |
| `dashboards/raum_popups.yaml` | Popups mit allen Geräten je Raum, nach Kategorien sortiert |

## Was die Raumübersicht zeigt

- Kopfzeile mit Wetter und Außentemperatur
- Pro Raum: Fensterstatus mit Dauer, Temperaturverlauf über 24 Stunden, Feuchte-Ampel (Schimmelschutz), Heizung mit Solltemperatur und die Lüften-Karte von Smart Ventilation
- Ein Tipp auf den Raumnamen öffnet das Geräte-Popup

## Was die Popups zeigen

Alle Geräte des Raums, automatisch aus dem Bereich (Area) geholt und sortiert nach Heizung und Klima, Licht, Steckdosen und Schalter, Rollos, Medien, Sensoren sowie Kontakten. Leere Kategorien werden ausgeblendet. Diagnose-Entitäten sind ausgefiltert.

## Voraussetzungen

- Home Assistant mit Sections-Dashboards
- [Smart Ventilation](https://github.com/patrickbrundiers-dev/smart_ventilation) ab Version 2.0.0
- HACS-Frontend-Karten: **Bubble Card** und **auto-entities**
- Bereiche (Areas) heißen wie die Räume: Schlafzimmer, Wohnzimmer, Bad, Nele, Lisa

## Einbau

1. Dashboard öffnen, Stift, dann ⋮ und **Raw-Konfigurationseditor**.
2. Inhalt von `raumuebersicht.yaml` als neue Ansicht unter `views:` einfügen.
3. Inhalt von `raum_popups.yaml` in dieselbe Ansicht einfügen, am besten ans Ende.
4. Speichern.

## Anpassen

Die Entity-IDs in `raumuebersicht.yaml` sind Platzhalter und folgen diesem Schema:

- `sensor.<raum>_temperatur`, `sensor.<raum>_luftfeuchtigkeit`
- `binary_sensor.<raum>_fenster`
- `climate.<raum>`
- `sensor.<raum>_empfehlung` (von Smart Ventilation)
- `weather.forecast_home`, `sensor.aussentemperatur` in der Kopfzeile

Bitte auf die eigenen Namen anpassen. Fehlende Entitäten zeigt Home Assistant als rote Karten.

## Status

Die Dateien sind als YAML geprüft, aber noch nicht in einer echten Home-Assistant-Installation getestet.
