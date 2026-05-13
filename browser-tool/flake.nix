{
  description = "browser-tool development shell";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = import nixpkgs { inherit system; };
        piPackage = pkgs.pi-coding-agent;
        piMonorepo = "${piPackage}/lib/node_modules/pi-monorepo";
        piNodeModules = "${piMonorepo}/node_modules";
        browserToolNodeModules = pkgs.runCommand "browser-tool-node-modules" {} ''
          mkdir -p "$out/@mariozechner" "$out/@types"
          ln -s "${piMonorepo}" "$out/@mariozechner/pi-coding-agent"
          ln -s "${piNodeModules}/@mariozechner/pi-tui" "$out/@mariozechner/pi-tui"
          ln -s "${piNodeModules}/@types/node" "$out/@types/node"
          ln -s "${piNodeModules}/tsx" "$out/tsx"
        '';
      in
      {
        devShells.default = pkgs.mkShell {
          name = "browser-tool-devshell";

          packages = [
            pkgs.nodejs_22
            pkgs.typescript
            pkgs.tsx
            pkgs.jq
            pkgs.yq
          ];

          shellHook = ''
            export PI_BROWSER_TOOL_DEV_SHELL=1
            export BROWSER_TOOL_NIX_NODE_MODULES="${browserToolNodeModules}"
            export NODE_PATH="${browserToolNodeModules}:${piNodeModules}:$NODE_PATH"

            if [ ! -e node_modules ]; then
              ln -s "${browserToolNodeModules}" node_modules
              echo "linked node_modules -> ${browserToolNodeModules}"
            elif [ -L node_modules ] && [ "$(readlink node_modules)" != "${browserToolNodeModules}" ]; then
              ln -sfn "${browserToolNodeModules}" node_modules
              echo "updated node_modules -> ${browserToolNodeModules}"
            fi

            echo "browser-tool dev shell"
            echo "node: $(node --version)"
            echo "npm:  $(npm --version)"
            echo "tsc:  $(tsc --version)"
            echo "tsx:  $(tsx --version)"
            echo ""
            echo "Nix-provided modules:"
            echo "  @mariozechner/pi-coding-agent -> ${piMonorepo}"
            echo "  @mariozechner/pi-tui          -> ${piNodeModules}/@mariozechner/pi-tui"
            echo "  @types/node                  -> ${piNodeModules}/@types/node"
            echo ""
            echo "Standalone tsc can now resolve pi packages via the generated node_modules symlink."
          '';
        };
      });
}
