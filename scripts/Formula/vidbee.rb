# Homebrew formula for @vidbee/cli.
#
# Place this file at the root of a tap repository (e.g. vidbee/homebrew-tap)
# under `Formula/vidbee.rb` and users can install with:
#
#     brew install vidbee/tap/vidbee
#
# The formula wraps the same npm tarball that `npm install -g @vidbee/cli`
# would resolve, so the installed binary is bit-for-bit identical to the
# npm and shell-installer paths. Bumping the version requires updating
# `version` and `sha256` to match the new tarball published to the npm
# registry. The CI workflow `cli-publish.yml` can be extended to open a PR
# against the tap repo on each tag.
class Vidbee < Formula
  desc "Agent-friendly yt-dlp downloader CLI for VidBee (Desktop & API hosts)"
  homepage "https://github.com/vidbee/vidbee"
  # When publishing a new version, replace the tarball URL with the npm
  # registry URL printed by `npm view @vidbee/cli@<version> dist.tarball`
  # and the sha256 with the matching `dist.shasum` (after converting hex
  # to sha256 via `npm view @vidbee/cli@<version> dist.integrity`).
  url "https://registry.npmjs.org/@vidbee/cli/-/cli-0.1.0.tgz"
  sha256 "0000000000000000000000000000000000000000000000000000000000000000"
  license "MIT"

  depends_on "node"

  def install
    system "npm", "install", "-g",
           "--prefix=#{libexec}",
           "--no-audit",
           "--no-fund",
           "@vidbee/cli@#{version}"
    bin.install_symlink Dir["#{libexec}/bin/vidbee"]
  end

  test do
    output = shell_output("#{bin}/vidbee :version")
    assert_match "vidbee", output.downcase
  end
end
