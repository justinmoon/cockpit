{
  description = "cockpit devshell + CI";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = import nixpkgs { inherit system; };
      in
      {
        devShells.default = pkgs.mkShell {
          packages = with pkgs; [
            bun
            just
            nodejs_22
            git
            openssh
            cacert
          ];

          shellHook = ''
            export IN_NIX_SHELL=1
          '';
        };
      });
}

