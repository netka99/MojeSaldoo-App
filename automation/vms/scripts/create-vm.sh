#!/usr/bin/env bash
# Wrapper for playbooks/create-vm.yml: spins up a local Fedora Cloud libvirt
# VM using the playbook's built-in defaults (vm_name=fedora-cloud-44,
# 2 vCPUs, 4096 MB RAM, 20 GB disk, default network). See playbooks/README.md
# for details. Takes no arguments; edit this script to change the defaults.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLAYBOOK="${SCRIPT_DIR}/../playbooks/create-vm.yml"

# The libvirt storage pool lives under the invoking user's home directory so
# the whole playbook runs without sudo/become. See playbooks/README.md for
# the one-time host setup (packages, libvirtd, disk chown) this assumes.
LIBVIRT_POOL_DIR="${HOME}/libvirt"

exec ansible-playbook "${PLAYBOOK}" -vvv \
  -e "libvirt_pool_dir=${LIBVIRT_POOL_DIR}"
