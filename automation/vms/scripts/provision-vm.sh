#!/usr/bin/env bash
# Wrapper for playbooks/provision-vm.yml: provisions the VM created by
# create-vm.sh for rootless Podman. Takes no arguments:
#
#   - The target VM is assumed to be the create-vm.sh default, named
#     "centos-stream10"; its IP is looked up via `virsh domifaddr`.
#   - The SSH user defaults to "zedr" (the user provisioned by a previous
#     run); if that's unreachable, this falls back to "root" for the first,
#     bootstrapping run (see playbooks/README.md).
#
# Edit this script if you need a different VM name or SSH key.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLAYBOOK="${SCRIPT_DIR}/../playbooks/provision-vm.yml"

vm_name="centos-stream10"

echo "Looking up the IP address of '${vm_name}' via virsh domifaddr..." >&2
host="$(virsh --connect qemu:///system domifaddr "${vm_name}" \
  | awk '/ipv4/ { print $4 }' | cut -d/ -f1 | head -n1)"

if [[ -z "${host}" ]]; then
  echo "Could not determine an IP address for VM '${vm_name}'." >&2
  echo "Make sure it is running and has obtained a DHCP lease." >&2
  exit 1
fi

echo "Found VM IP: ${host}" >&2

ssh_user="zedr"
if ! ssh -o BatchMode=yes -o ConnectTimeout=3 -o StrictHostKeyChecking=accept-new \
  "${ssh_user}@${host}" true 2>/dev/null; then
  echo "Could not reach '${ssh_user}@${host}'; falling back to 'root' for a first-time bootstrap run." >&2
  ssh_user="root"
fi

echo "Connecting as '${ssh_user}'..." >&2

# provision-vm.yml targets the `mojesaldoo_vms` group, so build a throwaway
# ini inventory for the single target host rather than requiring a
# hand-maintained inventory file.
inventory_file="$(mktemp)"
trap 'rm -f "${inventory_file}"' EXIT

{
  echo "[mojesaldoo_vms]"
  echo "${host} ansible_user=${ssh_user}"
} > "${inventory_file}"

# --ask-become-pass: become tasks run on the VM as the SSH user, and need
# that user's remote sudo password (zedr's, once created).
exec ansible-playbook "${PLAYBOOK}" \
  -i "${inventory_file}" \
  --ask-become-pass \
  -vv
