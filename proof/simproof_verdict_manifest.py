"""Evaluate the exact JSON controls shared with the TypeScript verifier.

The historical proof uses callable examples, whereas the production verifier's
fixtures are JSON. This adapter independently evaluates the JSON bytes and
emits their digest so parity cannot silently pass by evaluating a hard-coded
lookalike with the same verdict.
"""

import argparse
import hashlib
import json
import math
from pathlib import Path


G = 9.81
REL_TOL = 0.01
MAIN_GRID = ((20, 30), (30, 45), (25, 60), (40, 15), (15, 75))
PEAK_ANGLES = (30, 40, 45, 50, 60)
SAMPLE_FRACTIONS = (0, 0.25, 0.5, 0.75, 1)
VERIFICATION_INPUTS = MAIN_GRID + tuple(
    (30, angle) for angle in PEAK_ANGLES if (30, angle) not in MAIN_GRID
)
CANONICAL_PROJECTILE_UNITS = {
    "initialSpeed": "m/s",
    "launchAngle": "deg",
    "range": "m",
    "height": "m",
    "time": "s",
    "speed": "m/s",
}
CANONICAL_PENDULUM_UNITS = {"length": "m", "amplitude": "deg", "period": "s"}

# Each legacy proof label is comparable only to this exact fixture identity.
# The fixture payload, rather than the label, determines the emitted verdict.
COMPARABLE_CONTROLS = {
    "pendulum-correct": "correct/pendulum-correct.json",
    "pendulum-inverted": "negative-controls/pendulum-inverted-ratio.json",
    "projectile-coarse-euler": "negative-controls/projectile-coarse-euler.json",
    "projectile-correct": "correct/projectile-fine-symplectic.json",
    "projectile-dropped-factor": "negative-controls/projectile-dropped-factor.json",
    "projectile-radians-bug": "negative-controls/projectile-radians.json",
}


def _relative_error(actual, expected):
    return abs(actual - expected) if expected == 0 else abs(actual - expected) / abs(expected)


def _reference(speed, angle_deg):
    angle = math.radians(angle_deg)
    vertical_speed = speed * math.sin(angle)
    flight_time = 2 * vertical_speed / G
    return {
        "rangeM": speed * math.cos(angle) * flight_time,
        "apexHeightM": vertical_speed**2 / (2 * G),
        "flightTimeS": flight_time,
    }


def _reference_state(speed, angle_deg, time_seconds):
    angle = math.radians(angle_deg)
    horizontal_speed = speed * math.cos(angle)
    initial_vertical_speed = speed * math.sin(angle)
    vertical_speed = initial_vertical_speed - G * time_seconds
    return {
        "timeS": time_seconds,
        "xM": horizontal_speed * time_seconds,
        "yM": initial_vertical_speed * time_seconds - 0.5 * G * time_seconds**2,
        "speedMps": math.hypot(horizontal_speed, vertical_speed),
    }


def _integrated_summary(speed, angle_deg, step_seconds, symplectic, radians_bug):
    angle = angle_deg if radians_bug else math.radians(angle_deg)
    horizontal_speed = speed * math.cos(angle)
    vertical_speed = speed * math.sin(angle)
    x_position = y_position = apex = elapsed = 0.0
    while True:
        if symplectic:
            vertical_speed -= G * step_seconds
            x_position += horizontal_speed * step_seconds
            y_position += vertical_speed * step_seconds
        else:
            x_position += horizontal_speed * step_seconds
            y_position += vertical_speed * step_seconds
            vertical_speed -= G * step_seconds
        apex = max(apex, y_position)
        elapsed += step_seconds
        if y_position < 0 or elapsed > 100:
            break
    return {
        "rangeM": x_position,
        "apexHeightM": apex,
        "flightTimeS": elapsed,
        "initialSpeedMps": speed,
    }


def _integrated_state(speed, angle_deg, time_seconds, step_seconds, symplectic, radians_bug):
    angle = angle_deg if radians_bug else math.radians(angle_deg)
    horizontal_speed = speed * math.cos(angle)
    vertical_speed = speed * math.sin(angle)
    x_position = y_position = elapsed = 0.0
    while elapsed < time_seconds:
        step = min(step_seconds, time_seconds - elapsed)
        if symplectic:
            vertical_speed -= G * step
            x_position += horizontal_speed * step
            y_position += vertical_speed * step
        else:
            x_position += horizontal_speed * step
            y_position += vertical_speed * step
            vertical_speed -= G * step
        elapsed += step
    return {
        "timeS": time_seconds,
        "xM": x_position,
        "yM": y_position,
        "speedMps": math.hypot(horizontal_speed, vertical_speed),
    }


def _projectile_observation(fixture, speed, angle_deg):
    implementation = fixture.get("implementation")
    reference = _reference(speed, angle_deg)
    if implementation == "dropped-factor":
        angle = math.radians(angle_deg)
        range_m = speed**2 * math.sin(angle) / G
        return {
            "summary": {**reference, "rangeM": range_m, "initialSpeedMps": speed},
            "trajectory": [
                {
                    "timeS": reference["flightTimeS"] * fraction,
                    "xM": range_m * fraction,
                    "yM": reference["apexHeightM"] * math.sin(math.pi * fraction),
                    "speedMps": speed * (1 - 0.3 * fraction),
                }
                for fraction in SAMPLE_FRACTIONS
            ],
        }
    if implementation not in {"explicit-euler", "radians-bug", "symplectic"}:
        raise ValueError(f"unsupported shared projectile implementation: {implementation}")
    step_seconds = fixture.get("stepSeconds", 0.005)
    if not isinstance(step_seconds, (int, float)) or step_seconds <= 0 or not math.isfinite(step_seconds):
        raise ValueError("stepSeconds must be a positive finite number")
    symplectic = implementation == "symplectic"
    radians_bug = implementation == "radians-bug"
    return {
        "summary": _integrated_summary(
            speed, angle_deg, step_seconds, symplectic, radians_bug
        ),
        "trajectory": [
            _integrated_state(
                speed,
                angle_deg,
                reference["flightTimeS"] * fraction,
                step_seconds,
                symplectic,
                radians_bug,
            )
            for fraction in SAMPLE_FRACTIONS
        ],
    }


def _trajectory_is_valid(observation, speed, angle_deg):
    reference = _reference(speed, angle_deg)
    trusted_samples = [
        _reference_state(speed, angle_deg, reference["flightTimeS"] * fraction)
        for fraction in SAMPLE_FRACTIONS
    ]
    samples = observation["trajectory"]
    if len(samples) != len(trusted_samples):
        return False
    for candidate, trusted in zip(samples, trusted_samples):
        if abs(candidate["timeS"] - trusted["timeS"]) > 1e-10 * max(1, trusted["timeS"]):
            return False
        if abs(candidate["xM"] - trusted["xM"]) > 0.01 * reference["rangeM"]:
            return False
        allowed_y = max(0.02, 0.02 * reference["apexHeightM"])
        if abs(candidate["yM"] - trusted["yM"]) > allowed_y:
            return False
        energy = 0.5 * candidate["speedMps"] ** 2 + G * candidate["yM"]
        if _relative_error(energy, 0.5 * speed**2) > 0.02:
            return False
    return True


def _projectile_verdict(fixture):
    if fixture.get("units", CANONICAL_PROJECTILE_UNITS) != CANONICAL_PROJECTILE_UNITS:
        return "rejected"
    observations = {
        (speed, angle): _projectile_observation(fixture, speed, angle)
        for speed, angle in VERIFICATION_INPUTS
    }
    for speed, angle in MAIN_GRID:
        observation = observations[(speed, angle)]
        reference = _reference(speed, angle)
        if any(
            _relative_error(observation["summary"][quantity], reference[quantity]) > REL_TOL
            for quantity in ("rangeM", "apexHeightM", "flightTimeS")
        ):
            return "rejected"
        if not _trajectory_is_valid(observation, speed, angle):
            return "rejected"
    ranges = {angle: observations[(30, angle)]["summary"]["rangeM"] for angle in PEAK_ANGLES}
    highest_other = max(value for angle, value in ranges.items() if angle != 45)
    relative_excess = max(0, (highest_other - ranges[45]) / _reference(30, 45)["rangeM"])
    return "rejected" if relative_excess > REL_TOL else "verified"


def _pendulum_verdict(fixture):
    if fixture.get("domain") != "pendulum" or fixture.get("units") != CANONICAL_PENDULUM_UNITS:
        return "rejected"
    observations = fixture.get("observations")
    if not isinstance(observations, list):
        return "rejected"
    expected_grid = {(0.5, 5), (1, 10), (2, 15)}
    actual_grid = {
        (item.get("input", {}).get("lengthM"), item.get("input", {}).get("amplitudeDeg"))
        for item in observations
        if isinstance(item, dict) and isinstance(item.get("input"), dict)
    }
    if len(observations) != len(expected_grid) or actual_grid != expected_grid:
        return "rejected"
    for observation in observations:
        length = observation["input"]["lengthM"]
        period = observation.get("periodS")
        expected = 2 * math.pi * math.sqrt(length / G)
        if not isinstance(period, (int, float)) or not math.isfinite(period):
            return "rejected"
        if _relative_error(period, expected) > REL_TOL:
            return "rejected"
    return "verified"


def _arguments():
    default = Path(__file__).parents[1] / "tests" / "fixtures" / "proof-verdicts.json"
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", type=Path, default=default)
    return parser.parse_args()


def main():
    manifest_path = _arguments().manifest.resolve()
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    verdicts = []
    controls = []
    for case in manifest["cases"]:
        control_id = case.get("pythonControl")
        if control_id is None:
            continue
        if COMPARABLE_CONTROLS.get(control_id) != case["fixture"]:
            raise ValueError(f"{control_id} is not comparable to {case['fixture']}")
        fixture_path = manifest_path.parent / case["fixture"]
        fixture_bytes = fixture_path.read_bytes()
        fixture = json.loads(fixture_bytes)
        verdict = (
            _pendulum_verdict(fixture)
            if case["domain"] == "pendulum"
            else _projectile_verdict(fixture)
        )
        controls.append(control_id)
        verdicts.append(
            {
                "fixture": case["fixture"],
                "fixtureSha256": hashlib.sha256(fixture_bytes).hexdigest(),
                "verdict": verdict,
            }
        )
    print(
        json.dumps(
            {"schemaVersion": 1, "controls": sorted(controls), "verdicts": verdicts},
            sort_keys=True,
        )
    )


if __name__ == "__main__":
    main()
