{
  description = "TRLL Mountain Intelligence Suite (lakeloui.se) — dev environment";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = import nixpkgs {
          inherit system;
          config.allowUnfreePredicate = pkg: (pkg.pname or "") == "terraform";
        };
      in
      {
        devShells.default = pkgs.mkShell {
          buildInputs = with pkgs; [
            terraform
            nodejs_24
            nodePackages.npm
            awscli2
            python312
            python312Packages.pip
            jq
          ];

          shellHook = ''
            echo "lakeloui.se — TRLL Mountain Intelligence Suite"
            echo "  Terraform:  $(terraform version -json | jq -r '.terraform_version')"
            echo "  Node:       $(node --version)"
            echo "  AWS CLI:    $(aws --version 2>&1 | cut -d' ' -f1)"
            echo "  Python:     $(python3 --version)"
          '';
        };
      }
    );
}
