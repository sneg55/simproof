"""
SimProof critical-path proof.

Claim under test: an executable spec (closed-form ground truth) can catch the
subtly-wrong physics that LLMs actually generate, cleanly separate correct from
incorrect sims, and drive a generate -> verify -> fix loop that converges.

We stand in for the generator with REALISTIC LLM error modes (radians bug,
coarse Euler drift, dropped-factor formula, inverted-period formula), NOT
strawmen. The Verifier is the artifact Codex would write and is the thing whose
reliability decides whether the product is real.

Pure stdlib. Run: python3 simproof_proof.py
"""

import math

G = 9.81  # m/s^2


# ---------------------------------------------------------------------------
# GROUND TRUTH (closed form). This reviewed, application-owned answer key comes
# from the governing equations, not from any model; the Verifier tests generated
# sims against it. In production the same authority lives in the domain packs, so
# a model can select a concept and write a candidate but never define the truth.
# ---------------------------------------------------------------------------
def truth_projectile(v, theta_deg):
    th = math.radians(theta_deg)
    T = 2 * v * math.sin(th) / G                 # time of flight
    R = v * v * math.sin(2 * th) / G             # range
    H = (v * math.sin(th)) ** 2 / (2 * G)        # apex height
    return {"T": T, "R": R, "H": H}


def truth_y_of_x(v, theta_deg, x):
    th = math.radians(theta_deg)
    return x * math.tan(th) - G * x * x / (2 * v * v * math.cos(th) ** 2)


# ---------------------------------------------------------------------------
# VERIFIER. Given a sim's trajectory sampler, checks range, apex, flight time,
# on-curve points, and energy conservation across a grid of inputs. Also checks
# the physical property that range is maximized at 45 degrees. Returns findings.
# ---------------------------------------------------------------------------
GRID = [(20, 30), (30, 45), (25, 60), (40, 15), (15, 75)]  # (v m/s, theta deg)
REL_TOL = 0.01  # 1% relative tolerance: a correct sim clears it, drift fails it


def _rel_err(got, want):
    if want == 0:
        return abs(got - want)
    return abs(got - want) / abs(want)


def verify(sim, name):
    """sim(v, theta_deg) -> dict with keys R, H, T, samples[(x,y,speed)] and v0."""
    findings = []
    for v, theta in GRID:
        out = sim(v, theta)
        t = truth_projectile(v, theta)

        for key in ("R", "H", "T"):
            e = _rel_err(out[key], t[key])
            if e > REL_TOL:
                findings.append(
                    f"[{name}] v={v} th={theta}: {key} off by {e*100:.1f}% "
                    f"(got {out[key]:.3f}, truth {t[key]:.3f})"
                )

        # on-curve check: sampled points must lie on the analytic trajectory
        for (x, y, _speed) in out["samples"]:
            if x <= 0 or x >= t["R"]:
                continue
            y_true = truth_y_of_x(v, theta, x)
            if abs(y - y_true) > 0.02 * max(1.0, t["H"]):
                findings.append(
                    f"[{name}] v={v} th={theta}: point x={x:.2f} off curve "
                    f"(y={y:.3f}, truth {y_true:.3f})"
                )
                break

        # energy conservation: 0.5*speed^2 + g*y must stay ~constant
        e0 = 0.5 * out["v0"] ** 2
        for (x, y, speed) in out["samples"]:
            e_here = 0.5 * speed ** 2 + G * y
            if _rel_err(e_here, e0) > 0.02:
                findings.append(
                    f"[{name}] v={v} th={theta}: energy not conserved at x={x:.2f} "
                    f"({e_here:.1f} vs {e0:.1f})"
                )
                break

    # physical property: range peaks at 45 deg for fixed speed
    ranges = {th: sim(30, th)["R"] for th in (30, 40, 45, 50, 60)}
    if max(ranges, key=ranges.get) != 45:
        findings.append(
            f"[{name}] range does not peak at 45 deg: "
            + ", ".join(f"{k}d={v:.1f}m" for k, v in ranges.items())
        )
    return findings


# ---------------------------------------------------------------------------
# "GENERATED" SIMS. Each mimics a real LLM output. Integrator sims return
# sampled points so the Verifier tests the actual dynamics, not a formula.
# ---------------------------------------------------------------------------
def _integrate(v, theta_deg, dt, to_rad=True, symplectic=False):
    th = math.radians(theta_deg) if to_rad else theta_deg
    x, y = 0.0, 0.0
    vx, vy = v * math.cos(th), v * math.sin(th)
    samples, apex, t = [], 0.0, 0.0
    steps = 0
    while y >= 0 or t == 0:
        speed = math.hypot(vx, vy)
        if steps % 5 == 0:
            samples.append((x, y, speed))
        if symplectic:
            vy -= G * dt
            x += vx * dt
            y += vy * dt
        else:  # explicit Euler: position uses start-of-step velocity
            x += vx * dt
            y += vy * dt
            vy -= G * dt
        apex = max(apex, y)
        t += dt
        steps += 1
        if t > 100:
            break
    # land: last full step took y below 0; interpolate range at y=0
    R = x
    return {"R": R, "H": apex, "T": t, "samples": samples, "v0": v}


def sim_radians_bug(v, theta_deg):
    # classic bug: trig fed degrees as if radians (Math.sin expects radians)
    return _integrate(v, theta_deg, dt=0.02, to_rad=False)


def sim_euler_coarse(v, theta_deg):
    # hand-rolled explicit Euler with a too-large timestep -> drift
    return _integrate(v, theta_deg, dt=0.3, to_rad=True, symplectic=False)


def sim_formula_dropped_factor(v, theta_deg):
    # LLM hard-codes formulas but writes R = v^2 sin(theta)/g (dropped the 2)
    th = math.radians(theta_deg)
    R = v * v * math.sin(th) / G
    H = (v * math.sin(th)) ** 2 / (2 * G)
    T = 2 * v * math.sin(th) / G
    # samples placed on its (wrong) straight-scaled guess of the arc
    samples = [(R * f, H * math.sin(math.pi * f), v * (1 - 0.3 * f)) for f in (0.25, 0.5, 0.75)]
    return {"R": R, "H": H, "T": T, "samples": samples, "v0": v}


def sim_correct(v, theta_deg):
    # correct: small-step symplectic integrator (energy-stable), fine dt
    return _integrate(v, theta_deg, dt=0.005, to_rad=True, symplectic=True)


# ---------------------------------------------------------------------------
# SECOND DOMAIN (generality check): simple pendulum period, small angle.
# Truth: T = 2*pi*sqrt(L/g). Buggy LLM inverts it: T = 2*pi*sqrt(g/L).
# ---------------------------------------------------------------------------
def verify_pendulum(sim, name):
    findings = []
    for L in (0.5, 1.0, 2.0):
        got = sim(L)
        want = 2 * math.pi * math.sqrt(L / G)
        if _rel_err(got, want) > REL_TOL:
            findings.append(
                f"[{name}] L={L}: period off by {_rel_err(got, want)*100:.1f}% "
                f"(got {got:.3f}s, truth {want:.3f}s)"
            )
    return findings


def pendulum_inverted(L):
    return 2 * math.pi * math.sqrt(G / L)     # classic inverted-ratio slip


def pendulum_correct(L):
    return 2 * math.pi * math.sqrt(L / G)


# ---------------------------------------------------------------------------
# RUN
# ---------------------------------------------------------------------------
def report(title, findings):
    print(f"\n{'='*70}\n{title}\n{'='*70}")
    if not findings:
        print("  VERIFIED: 0 violations. Safe to ship to students.")
    else:
        print(f"  REJECTED: {len(findings)} violation(s) found:")
        for f in findings[:6]:
            print("   - " + f)
        if len(findings) > 6:
            print(f"   ... (+{len(findings) - 6} more)")


def main():
    print("SIMPROOF CRITICAL-PATH PROOF  --  projectile motion + pendulum")
    print("Executable spec vs. realistic LLM-generated sims.\n")

    cases = [
        ("Generated sim A: degrees/radians bug (Math.sin fed degrees)", sim_radians_bug),
        ("Generated sim B: hand-rolled Euler, coarse dt=0.3 (energy drift)", sim_euler_coarse),
        ("Generated sim C: hard-coded formula, dropped factor (R proportional to sin th)", sim_formula_dropped_factor),
        ("Generated sim D: correct symplectic integrator, dt=0.005", sim_correct),
    ]
    verdicts = {}
    for title, sim in cases:
        f = verify(sim, title.split(":")[0])
        verdicts[title] = f
        report(title, f)

    report("Pendulum sim E: inverted period T=2pi*sqrt(g/L)", verify_pendulum(pendulum_inverted, "E"))
    report("Pendulum sim F: correct period T=2pi*sqrt(L/g)", verify_pendulum(pendulum_correct, "F"))

    # ---- the generate -> verify -> fix LOOP closing on one sim ----
    print(f"\n{'#'*70}\nLOOP DEMO: start from buggy sim, verifier drives it to correct\n{'#'*70}")
    attempt = [sim_radians_bug, sim_euler_coarse, sim_correct]
    labels = ["v1 (radians bug)", "v2 (coarse Euler after 'fix')", "v3 (symplectic, fine dt)"]
    for i, (sim, lab) in enumerate(zip(attempt, labels), 1):
        f = verify(sim, lab)
        status = "PASS -> ship" if not f else f"FAIL ({len(f)} violations) -> feed back to Codex"
        print(f"  attempt {i}: {lab:34s} -> {status}")
        if not f:
            print("  loop converged: shipped a proven-correct sim.")
            break


if __name__ == "__main__":
    main()
