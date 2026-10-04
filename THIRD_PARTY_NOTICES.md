# Third-Party Sources

## OpenMir2

- Source: https://github.com/mirbeta/OpenMir2
- Revision: `184748310d00e611e5a2c7e70f1931b5b805e7e1`
- License: MIT, in `upstream/openmir2/LICENSE`.
- Included as a Git submodule. `server/openmir2-linux.patch` is applied during the engine build; the checkout remains unmodified.

## Classic Data And Images

- Published asset conversion: https://github.com/fq393/mir2-web at `7e5782118c78defb42d8ffb55ca3a3de199e90a6`.
- All downloaded files have paths, sizes and Git blob SHA-1 values in `shared/classic-assets.lock.json`. Images originate from the commercial Legend of Mir client; the asset manifests retain their recorded source information. No application code from that repository is included.
- Server environment and map seed: https://github.com/mirbeta/MirServer at `f38deae64c521a28f8e0d86f2bf24d4ba7c9ea5c`, archive SHA-256 `b3a9f10e96036aad7bd97b0f65fa221fae0457c1e5a9e6500720a09039916334`. Lock: `shared/server-data.lock.json`.
- Monster, item and skill SQL comes from the pinned OpenMir2 repository. The seed contains mixed-version data; only the audited Bichon profile is enabled.
- Experience sources and the Level18 discrepancy are recorded in `shared/classic-experience.json`. The tables are community references, not authenticated official server data.
- Neither the source-code licenses nor this project grant rights to the original game's commercial images, maps, marks or audio. Asset rights are separate from the MIT server license.

## Client Libraries

- Phaser: https://github.com/phaserjs/phaser (MIT)
- PathFinding.js: https://github.com/qiao/PathFinding.js (MIT)
- Lucide: https://github.com/lucide-icons/lucide (ISC)
- Versions are pinned in `package-lock.json`.

The previous Crystal engine and substitute Kenney demo assets have been removed. Candidate comparisons and actual research findings remain in `docs/SOURCE_RESEARCH.md`.
