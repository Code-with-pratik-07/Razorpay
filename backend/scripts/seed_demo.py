import argparse
import sys
from pathlib import Path

# Ensure backend directory is in sys.path when invoked directly from any working directory
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services.demo_service import seed_demo_data

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Seed database with realistic demo cases.")
    parser.add_argument("--reset", action="store_true", help="Drop all tables and recreate before seeding.")
    args = parser.parse_args()
    seed_demo_data(reset=args.reset)
