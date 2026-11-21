#!/usr/bin/env python3
"""
Fetches real geospatial ski trails (piste:type=downhill) and lifts (aerialway=*)
from the OpenStreetMap 0.6 JSON API for Banff National Park's SkiBig3 resorts
(Banff Sunshine Village, Lake Louise Ski Resort, Mt. Norquay) and writes
compact, enriched GeoJSON files to public/geojson/<resort>.geojson.
"""

import json
import math
import os
import re
import urllib.request

RESORTS = {
    "sunshine": {
        "name": "Banff Sunshine Village",
        "bbox": (-115.812, 51.060, -115.745, 51.125),
    },
    "lakelouise": {
        "name": "Lake Louise Ski Resort",
        "bbox": (-116.195, 51.425, -116.085, 51.495),
    },
    "norquay": {
        "name": "Mt. Norquay",
        "bbox": (-115.620, 51.190, -115.585, 51.218),
    },
}

EXCLUDED_AERIALWAYS = {"pylon", "station", "goods", "zip_line", "canopy", "rope_tow_unused"}


def haversine_m(coords):
    total = 0.0
    r = 6371000.0
    for i in range(1, len(coords)):
        lon1, lat1 = math.radians(coords[i - 1][0]), math.radians(coords[i - 1][1])
        lon2, lat2 = math.radians(coords[i][0]), math.radians(coords[i][1])
        dlon = lon2 - lon1
        dlat = lat2 - lat1
        a = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
        total += 2 * r * math.asin(min(1.0, math.sqrt(a)))
    return round(total)


def norm_name(s):
    if not s:
        return ""
    s = s.lower().replace("&amp;", "and").replace("&", "and").replace("&#039;", "")
    s = re.sub(r"\b(quad|chairlift|chair|express|high speed|six pack|luxury|fixed grip|conveyor|carpet|gondola|platter|t-bar|the)\b", " ", s)
    return re.sub(r"[^a-z0-9]+", "", s)


def map_difficulty(raw, name=""):
    r = (raw or "").lower().strip()
    if r in ("novice", "easy"):
        return "green"
    if r in ("intermediate",):
        return "blue"
    if r in ("advanced",):
        return "black"
    if r in ("expert", "freeride", "extreme"):
        return "double-black"
    # Fallback heuristics
    nl = (name or "").lower()
    if any(k in nl for k in ("chute", "couloir", "delirium", "wild west", "cliff")):
        return "double-black"
    if any(k in nl for k in ("easy", "green", "meadow", "sundance", "dell")):
        return "green"
    return "blue"


def build_geojson(resort_id, cfg):
    w, s, e, n = cfg["bbox"]
    url = f"https://api.openstreetmap.org/api/0.6/map.json?bbox={w},{s},{e},{n}"
    req = urllib.request.Request(url, headers={"User-Agent": "PowderlineBanffApp/1.0"})
    raw = json.loads(urllib.request.urlopen(req, timeout=20).read().decode("utf-8"))

    nodes = {}
    for el in raw.get("elements", []):
        if el.get("type") == "node":
            nodes[el["id"]] = (round(el["lon"], 6), round(el["lat"], 6))

    features = []
    trail_count = 0
    lift_count = 0

    for el in raw.get("elements", []):
        if el.get("type") != "way":
            continue
        tags = el.get("tags") or {}
        node_ids = el.get("nodes") or []
        coords = [nodes[nid] for nid in node_ids if nid in nodes]
        if len(coords) < 2:
            continue

        # 1. Ski Trails (downhill + terrain park)
        piste_type = tags.get("piste:type")
        if piste_type in ("downhill", "playground", "snow_park"):
            name = tags.get("name") or tags.get("piste:name") or tags.get("ref") or ""
            raw_diff = tags.get("piste:difficulty", "")
            diff = map_difficulty(raw_diff, name)
            grooming = tags.get("piste:grooming", "")
            gladed = (
                tags.get("piste:gladed") == "yes"
                or "glade" in name.lower()
                or "trees" in name.lower()
            )
            features.append(
                {
                    "type": "Feature",
                    "id": f"way-{el['id']}",
                    "properties": {
                        "osmId": el["id"],
                        "featureType": "trail",
                        "resortId": resort_id,
                        "name": name or "Connector Trail",
                        "isUnnamed": not bool(name),
                        "normName": norm_name(name),
                        "difficulty": diff,
                        "rawDifficulty": raw_diff or "intermediate",
                        "pisteType": piste_type,
                        "groomingTag": grooming,
                        "gladed": gladed,
                        "ref": tags.get("ref", ""),
                        "lengthMeters": haversine_m(coords),
                    },
                    "geometry": {
                        "type": "LineString",
                        "coordinates": coords,
                    },
                }
            )
            trail_count += 1
            continue

        # 2. Ski Lifts (aerialways)
        aerialway = tags.get("aerialway")
        if aerialway and aerialway not in EXCLUDED_AERIALWAYS:
            # Skip purely summer sightseeing if tagged disused/abandoned
            if tags.get("abandoned") == "yes" or tags.get("disused") == "yes":
                continue
            name = tags.get("name") or f"{aerialway.replace('_', ' ').title()}"
            features.append(
                {
                    "type": "Feature",
                    "id": f"way-{el['id']}",
                    "properties": {
                        "osmId": el["id"],
                        "featureType": "lift",
                        "resortId": resort_id,
                        "name": name,
                        "normName": norm_name(name),
                        "liftType": aerialway,
                        "occupancy": tags.get("aerialway:occupancy", ""),
                        "detachable": tags.get("aerialway:detachable") == "yes",
                        "bubble": tags.get("aerialway:bubble") == "yes",
                        "heated": tags.get("aerialway:heating") == "yes",
                        "lengthMeters": haversine_m(coords),
                    },
                    "geometry": {
                        "type": "LineString",
                        "coordinates": coords,
                    },
                }
            )
            lift_count += 1

    out_dir = os.path.join(os.path.dirname(__file__), "..", "public", "geojson")
    os.makedirs(out_dir, exist_ok=True)
    out_path = os.path.join(out_dir, f"{resort_id}.geojson")
    fc = {
        "type": "FeatureCollection",
        "metadata": {
            "resortId": resort_id,
            "resortName": cfg["name"],
            "trailSegments": trail_count,
            "lifts": lift_count,
        },
        "features": features,
    }
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(fc, f, ensure_ascii=False, separators=(",", ":"))
    size_kb = os.path.getsize(out_path) / 1024
    print(f"[{resort_id}] Saved {trail_count} trail segments & {lift_count} lifts -> {out_path} ({size_kb:.1f} KB)")


if __name__ == "__main__":
    for rid, cfg in RESORTS.items():
        build_geojson(rid, cfg)
