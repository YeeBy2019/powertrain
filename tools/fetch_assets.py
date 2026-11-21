# Downloads the SimReady GLBs used by Powertrain from codepawl/simready-glb.
# Requires HTTPS_PROXY if the machine cannot reach huggingface.co directly.
# Existing files are skipped, so this only fetches the powertrain-specific increment.
import sys
import urllib.request
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

BASE_URL = "https://huggingface.co/datasets/codepawl/simready-glb/resolve/main"
PROJECT = Path(__file__).resolve().parent.parent
ASSET_DIR = PROJECT / "public" / "assets"
THUMB_DIR = PROJECT / "thumbs"

# Powertrain assembly hall: engine assemblies as the flowing product, robots, test benches,
# gearbox/differential, chassis frames and loose engine components as set dressing.
POWERTRAIN = """
engineAssembly_v8_engine_a01 engineAssembly_v6_engine_a01 engineAssembly_v12_engine_a01 engineAssembly_electric_engine_a01
robotic_system_arm_b01 robotic_system_a01 robotic_system_console_b01
carFrame_car_frame_assembled_a01
testingTool_alignment_machine_a01 testingTool_brake_testing_station_a01
testingTool_emission_tester_a01 testingTool_wheel_alignment_lift_main_b01
workstation_factory_a01
drivetrain_transmission_auto_a01 drivetrain_differential_a01
engineComponent_crankshaft_b01 engineComponent_cylinder_head_a01 engineComponent_turbocompressor_a01
wheelAssembly_tire_a01
lighting_overheadLed_hexGrid_a01
""".split()

ASSETS = POWERTRAIN


def download(url: str, destination: Path) -> None:
    if destination.exists() and destination.stat().st_size > 0:
        return
    destination.parent.mkdir(parents=True, exist_ok=True)
    last_error = None
    for attempt in range(4):
        try:
            request = urllib.request.Request(url, headers={"User-Agent": "powertrain"})
            with urllib.request.urlopen(request, timeout=180) as response:
                data = response.read()
            destination.write_bytes(data)
            return
        except Exception as error:
            last_error = error
            print(f"  retry {attempt + 1}/4 for {destination.name}: {error}", flush=True)
    raise last_error


def main() -> None:
    missing = []
    for asset in ASSETS:
        destination = ASSET_DIR / f"{asset}.glb"
        try:
            download(f"{BASE_URL}/glb/{asset}.glb", destination)
            print(f"OK {asset} {destination.stat().st_size / 1e6:.2f}MB", flush=True)
        except Exception as error:
            missing.append(asset)
            print(f"FAILED {asset}: {error}", flush=True)
            continue
        try:
            download(f"{BASE_URL}/thumbs/{asset}.webp", THUMB_DIR / f"{asset}.webp")
        except Exception:
            pass
    print(f"\nDone. {len(ASSETS) - len(missing)}/{len(ASSETS)} GLBs available.")
    if missing:
        print("Missing:", ", ".join(missing))


main()
