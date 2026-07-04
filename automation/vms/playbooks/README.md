# VM Playbooks

## `create-vm.yml`

### Summary

Spins up a local Fedora Cloud VM on libvirt (`qemu:///system`). Downloads the
official Fedora Cloud Base Generic qcow2 image (checksum-verified), creates a
qcow2 overlay disk from it, and boots it with `virt-install --import`. No
cloud-init or other provisioning is done — the VM is left as a blank cloud
image for you to provision later (e.g. via the serial console or your own
tooling).

The playbook has no `become`/sudo tasks — it only runs as the invoking user.
This means `qemu-kvm`, `libvirt`, `virt-install`, a running `libvirtd`, and
correct ownership on the VM disk must already be in place before you run it
(see [Prerequisites](#prerequisites) below). The invoking user must also
already be authorized against `qemu:///system` (e.g. a member of the
`libvirt` group), same as for interactive `virsh` use.

The libvirt storage pool directory (`libvirt_pool_dir`, default `~/libvirt`)
is created and written to as the invoking user —
`automation/vms/scripts/create-vm.sh` passes `~/libvirt` explicitly.

### Run

```bash
ansible-playbook automation/vms/playbooks/create-vm.yml \
  -e vm_name=my-fedora-vm
```

Variables (override with `-e`):

| Variable | Default | Notes |
| --- | --- | --- |
| `vm_name` | `fedora-cloud-44` | libvirt domain name |
| `vm_vcpus` | `2` | |
| `vm_memory_mb` | `4096` | |
| `vm_disk_gb` | `20` | size of the qcow2 overlay disk |
| `vm_network` | `default` | libvirt network to attach to |
| `libvirt_pool_dir` | `~/libvirt` | storage pool directory (per-VM disks); owned by the invoking user |
| `cached_images_dir` | `~/libvirt/.cached-images` | where the downloaded base cloud image is cached; skipped on subsequent runs if already present |
| `fedora_release` | `44` | Fedora release number; there's no "latest" pointer, so bump this by hand for a new release (see [fedoraproject.org/cloud/download](https://fedoraproject.org/cloud/download)) |
| `fedora_release_respin` | `1.7` | respin of that release's Cloud image |

### Prerequisites

None of this playbook's tasks use `become` — the following steps require
root and must be done manually, once, before running it:

```bash
# 1. Install required host packages
sudo dnf install -y qemu-kvm libvirt libvirt-daemon-kvm virt-install

# 2. Ensure libvirtd is running and enabled
sudo systemctl enable --now libvirtd
```

The third step — setting ownership on the VM disk so `qemu:///system` can
access it — can only be done after the qcow2 disk exists, so it comes after
your first run of the playbook creates the disk but before `virt-install`
boots it:

```bash
# 3. Run the playbook once to create the disk (it will fail/skip the VM
#    boot step since the disk isn't owned by qemu yet), then:
sudo chown qemu:qemu ~/libvirt/<vm_name>.qcow2
sudo chmod 0660 ~/libvirt/<vm_name>.qcow2

# Re-run the playbook to define and start the VM.
```

Replace `<vm_name>` with the domain name (default `fedora-cloud-44`) and
adjust the path if you override `libvirt_pool_dir`. Subsequent VMs created
in the same pool only need step 3 repeated per new disk — steps 1–2 are
one-time host setup.

### Connect

```bash
virsh --connect qemu:///system console my-fedora-vm
```

The cloud image ships with no configured user/password and no SSH keys, so
console access via `virsh console` is the only way in until you provision it.

### Teardown

```bash
virsh --connect qemu:///system destroy my-fedora-vm
virsh --connect qemu:///system undefine my-fedora-vm --remove-all-storage
```
## `provision-vm.yml`

### Summary

Provisions the VM with the software and configuration needed to run the
MojeSaldoo application.

The application runs in rootless Podman containers inside the VM. These pods
have stateful volumes for the data, e.g. postgresql data. Pod orchestration
and management is done via systemd, **not** Podman Compose. 

Upon first provisioning, a user `zedr` is created with a very strong randomly 
generated password which is printed via a `debug` task. User `zedr` is a 
member of wheel. The public SSH key specified in the playbook is added to the 
authorized users file. After this, SSH access for root is disabled.

Requires the `ansible.posix` collection (for `authorized_key`):

```bash
ansible-galaxy collection install ansible.posix
```

### Bootstrapping

The cloud image created by `create-vm.yml` has no user, password, or SSH key
configured, so this playbook must connect as `root` over SSH the first time.
Before running it, use `virsh console` to log in and either add a temporary
root SSH key or set a temporary root password:

```bash
virsh --connect qemu:///system console my-fedora-vm
```

Once root access is available over SSH, point an inventory at the VM (or pass
`ansible_host`/`ansible_user` with `-e`) and run:

```bash
ansible-playbook automation/vms/playbooks/provision-vm.yml \
  -i <inventory-with-vm> \
  -e ansible_user=root
```

Since the last task disables root SSH login, this first run is a one-shot
bootstrap. Subsequent re-runs should connect as `zedr` (who has `sudo`/`become`
via `wheel`) instead of `root`.

Variables (override with `-e`):

| Variable | Default | Notes |
| --- | --- | --- |
| `app_user` | `zedr` | user created on the VM |
| `zedr_ssh_pubkey_file` | `~/.ssh/id_ed25519.pub` | public key (on the control host) installed into `zedr`'s `authorized_keys` |
