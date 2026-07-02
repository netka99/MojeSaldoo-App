# VM Playbooks

## `create_centos_stream10_vm.yml`

Spins up a local CentOS Stream 10 VM on libvirt (`qemu:///system`). Downloads
the official GenericCloud qcow2 image (checksum-verified), creates a qcow2
overlay disk from it, and boots it with `virt-install --import`. No
cloud-init or other provisioning is done — the VM is left as a blank cloud
image for you to provision later (e.g. via the serial console or your own
tooling).

Requires `qemu-kvm`, `libvirt`, and `virt-install` — installed automatically
via `become` if missing. The invoking user must already be authorized against
`qemu:///system` (e.g. a member of the `libvirt` group), same as for
interactive `virsh` use.

### Run

```bash
ansible-playbook automation/vms/playbooks/create_centos_stream10_vm.yml \
  -e vm_name=my-centos-vm
```

Variables (override with `-e`):

| Variable | Default | Notes |
| --- | --- | --- |
| `vm_name` | `centos-stream10` | libvirt domain name |
| `vm_vcpus` | `2` | |
| `vm_memory_mb` | `4096` | |
| `vm_disk_gb` | `20` | size of the qcow2 overlay disk |
| `vm_network` | `default` | libvirt network to attach to |

### Connect

```bash
virsh --connect qemu:///system console my-centos-vm
```

The cloud image ships with no configured user/password and no SSH keys, so
console access via `virsh console` is the only way in until you provision it.

### Teardown

```bash
virsh --connect qemu:///system destroy my-centos-vm
virsh --connect qemu:///system undefine my-centos-vm --remove-all-storage
```
