import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { userProfilesApi } from '../lib/api';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../components/ui/dialog';
import { Label } from '../components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select';
import { CheckCircle, XCircle, AlertTriangle, Loader2, UserPlus, Shield, ShieldOff } from 'lucide-react';

const ROLE_LABELS = {
  admin: 'Administrador',
  almacen: 'Almacén',
  sales: 'Ventas',
  viewer: 'Visualizador'
};

const ROLE_COLORS = {
  admin: 'default',
  almacen: 'secondary',
  sales: 'outline',
  viewer: 'outline'
};

export default function UserManagement() {
  const { hasPermission, profile: currentProfile } = useAuth();
  const [profiles, setProfiles] = useState([]);
  const [availableUsers, setAvailableUsers] = useState([]);
  const [roles, setRoles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Dialog states
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [showRoleDialog, setShowRoleDialog] = useState(false);
  const [selectedProfile, setSelectedProfile] = useState(null);
  const [selectedUser, setSelectedUser] = useState('');
  const [selectedRole, setSelectedRole] = useState('viewer');
  const [saving, setSaving] = useState(false);

  // Check permission
  if (!hasPermission('manageUsers')) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <ShieldOff className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
          <h2 className="text-lg font-semibold">Acceso Denegado</h2>
          <p className="text-muted-foreground">No tienes permiso para gestionar usuarios.</p>
        </div>
      </div>
    );
  }

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const [profilesRes, usersRes, rolesRes] = await Promise.all([
        userProfilesApi.getAllProfiles(),
        userProfilesApi.getAvailableUsers(),
        userProfilesApi.getRoles()
      ]);
      setProfiles(profilesRes.data);
      setAvailableUsers(usersRes.data);
      setRoles(rolesRes.data);
    } catch (err) {
      setError(err.response?.data?.error || 'Error al cargar datos');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleAddUser = async () => {
    if (!selectedUser || !selectedRole) return;
    setSaving(true);
    try {
      await userProfilesApi.createProfile(selectedUser, selectedRole);
      setShowAddDialog(false);
      setSelectedUser('');
      setSelectedRole('viewer');
      await loadData();
    } catch (err) {
      setError(err.response?.data?.error || 'Error al agregar usuario');
    } finally {
      setSaving(false);
    }
  };

  const handleUpdateRole = async () => {
    if (!selectedProfile || !selectedRole) return;
    setSaving(true);
    try {
      await userProfilesApi.updateRole(selectedProfile._id, selectedRole);
      setShowRoleDialog(false);
      setSelectedProfile(null);
      await loadData();
    } catch (err) {
      setError(err.response?.data?.error || 'Error al actualizar rol');
    } finally {
      setSaving(false);
    }
  };

  const handleToggleStatus = async (profile) => {
    const action = profile.isActive ? 'desactivar' : 'activar';
    if (!confirm(`¿${action.charAt(0).toUpperCase() + action.slice(1)} a ${profile.user?.firstname} ${profile.user?.lastname}?`)) {
      return;
    }
    try {
      await userProfilesApi.updateStatus(profile._id, !profile.isActive);
      await loadData();
    } catch (err) {
      setError(err.response?.data?.error || `Error al ${action} usuario`);
    }
  };

  const openRoleDialog = (profile) => {
    setSelectedProfile(profile);
    setSelectedRole(profile.role);
    setShowRoleDialog(true);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Gestión de Usuarios</h1>
          <p className="text-muted-foreground">Administra roles y permisos de usuarios</p>
        </div>
        {availableUsers.length > 0 && (
          <Button onClick={() => setShowAddDialog(true)}>
            <UserPlus className="mr-2 h-4 w-4" />
            Agregar Usuario
          </Button>
        )}
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-4 text-red-800">
          <XCircle className="h-5 w-5" />
          {error}
          <Button variant="ghost" size="sm" onClick={() => setError(null)} className="ml-auto">
            Cerrar
          </Button>
        </div>
      )}

      {/* Roles Legend */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Roles del Sistema</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {roles.map((r) => (
              <div key={r.role} className="rounded-lg border p-3">
                <div className="flex items-center gap-2 mb-1">
                  <Badge variant={ROLE_COLORS[r.role]}>{ROLE_LABELS[r.role]}</Badge>
                  {r.requiresSap && (
                    <span className="text-xs text-yellow-600" title="Requiere credenciales SAP">
                      SAP
                    </span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  {r.permissions.join(', ')}
                </p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Users Table */}
      <Card>
        <CardHeader>
          <CardTitle>Usuarios ({profiles.length})</CardTitle>
          <CardDescription>
            Usuarios con acceso a la aplicación
          </CardDescription>
        </CardHeader>
        <CardContent>
          {profiles.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">
              No hay usuarios configurados
            </p>
          ) : (
            <div className="space-y-2">
              {profiles.map((p) => {
                const isCurrentUser = p._id === currentProfile?._id;
                const roleInfo = roles.find(r => r.role === p.role);

                return (
                  <div
                    key={p._id}
                    className={`flex items-center justify-between rounded-lg border p-4 ${
                      !p.isActive ? 'bg-muted/50 opacity-60' : ''
                    }`}
                  >
                    <div className="flex items-center gap-4">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-medium">
                            {p.user?.firstname} {p.user?.lastname}
                          </span>
                          {isCurrentUser && (
                            <Badge variant="outline" className="text-xs">Tú</Badge>
                          )}
                          {!p.isActive && (
                            <Badge variant="destructive" className="text-xs">Inactivo</Badge>
                          )}
                        </div>
                        <p className="text-sm text-muted-foreground">{p.user?.email}</p>
                      </div>
                    </div>

                    <div className="flex items-center gap-4">
                      {/* SAP Status */}
                      <div className="text-center">
                        {roleInfo?.requiresSap ? (
                          p.sapCredentials?.hasPassword ? (
                            <div className="flex items-center gap-1 text-green-600">
                              <CheckCircle className="h-4 w-4" />
                              <span className="text-xs">SAP OK</span>
                            </div>
                          ) : (
                            <div className="flex items-center gap-1 text-yellow-600">
                              <AlertTriangle className="h-4 w-4" />
                              <span className="text-xs">SAP pendiente</span>
                            </div>
                          )
                        ) : (
                          <span className="text-xs text-muted-foreground">-</span>
                        )}
                      </div>

                      {/* Role Badge */}
                      <Badge
                        variant={ROLE_COLORS[p.role]}
                        className="cursor-pointer hover:opacity-80"
                        onClick={() => !isCurrentUser && openRoleDialog(p)}
                      >
                        {ROLE_LABELS[p.role]}
                      </Badge>

                      {/* Actions */}
                      {!isCurrentUser && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleToggleStatus(p)}
                          title={p.isActive ? 'Desactivar' : 'Activar'}
                        >
                          {p.isActive ? (
                            <ShieldOff className="h-4 w-4 text-muted-foreground" />
                          ) : (
                            <Shield className="h-4 w-4 text-green-600" />
                          )}
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Add User Dialog */}
      <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Agregar Usuario</DialogTitle>
            <DialogDescription>
              Selecciona un usuario y asígnale un rol
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Usuario</Label>
              <Select value={selectedUser} onValueChange={setSelectedUser}>
                <SelectTrigger>
                  <SelectValue placeholder="Seleccionar usuario" />
                </SelectTrigger>
                <SelectContent>
                  {availableUsers.map((u) => (
                    <SelectItem key={u._id} value={u._id}>
                      {u.firstname} {u.lastname} ({u.email})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Rol</Label>
              <Select value={selectedRole} onValueChange={setSelectedRole}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {roles.map((r) => (
                    <SelectItem key={r.role} value={r.role}>
                      {ROLE_LABELS[r.role]}
                      {r.requiresSap && ' (requiere SAP)'}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddDialog(false)}>
              Cancelar
            </Button>
            <Button onClick={handleAddUser} disabled={saving || !selectedUser}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Agregar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Change Role Dialog */}
      <Dialog open={showRoleDialog} onOpenChange={setShowRoleDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cambiar Rol</DialogTitle>
            <DialogDescription>
              {selectedProfile?.user?.firstname} {selectedProfile?.user?.lastname}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Nuevo Rol</Label>
              <Select value={selectedRole} onValueChange={setSelectedRole}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {roles.map((r) => (
                    <SelectItem key={r.role} value={r.role}>
                      {ROLE_LABELS[r.role]}
                      {r.requiresSap && ' (requiere SAP)'}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {roles.find(r => r.role === selectedRole)?.requiresSap && (
              <div className="flex items-center gap-2 rounded-lg border border-yellow-200 bg-yellow-50 p-3 text-sm text-yellow-800">
                <AlertTriangle className="h-4 w-4" />
                Este rol requiere que el usuario configure sus credenciales SAP
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowRoleDialog(false)}>
              Cancelar
            </Button>
            <Button onClick={handleUpdateRole} disabled={saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Guardar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
