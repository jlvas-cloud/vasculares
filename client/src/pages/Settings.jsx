import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { userProfilesApi } from '../lib/api';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { CheckCircle, XCircle, AlertTriangle, Loader2, Eye, EyeOff, Trash2 } from 'lucide-react';

const ROLE_LABELS = {
  admin: 'Administrador',
  almacen: 'Almacén',
  sales: 'Ventas',
  viewer: 'Visualizador'
};

const ROLE_DESCRIPTIONS = {
  admin: 'Acceso completo: recepciones, consignaciones, consumos, gestión de usuarios',
  almacen: 'Operaciones de almacén: recepciones, consignaciones, consumos',
  sales: 'Ventas: ver inventario, modificar stock objetivo',
  viewer: 'Solo lectura: ver inventario'
};

export default function Settings() {
  const { user, profile, loadProfile, requiresSapCredentials, hasSapCredentials } = useAuth();

  const [sapUsername, setSapUsername] = useState(profile?.sapCredentials?.username || '');
  const [sapPassword, setSapPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [message, setMessage] = useState(null);

  const handleSave = async (e) => {
    e.preventDefault();
    if (!sapUsername || !sapPassword) {
      setMessage({ type: 'error', text: 'Usuario y contraseña son requeridos' });
      return;
    }

    setSaving(true);
    setMessage(null);

    try {
      await userProfilesApi.saveSapCredentials(sapUsername, sapPassword);
      setSapPassword('');
      await loadProfile();
      setMessage({ type: 'success', text: 'Credenciales guardadas. Prueba la conexión para verificar.' });
    } catch (err) {
      setMessage({ type: 'error', text: err.response?.data?.error || 'Error al guardar credenciales' });
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    setMessage(null);

    try {
      const res = await userProfilesApi.testSapCredentials();
      await loadProfile();
      setMessage({ type: 'success', text: res.data.message || 'Conexión exitosa' });
    } catch (err) {
      setMessage({ type: 'error', text: err.response?.data?.message || 'Error de autenticación SAP' });
    } finally {
      setTesting(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm('¿Eliminar credenciales SAP?')) return;

    setDeleting(true);
    setMessage(null);

    try {
      await userProfilesApi.deleteSapCredentials();
      setSapUsername('');
      setSapPassword('');
      await loadProfile();
      setMessage({ type: 'success', text: 'Credenciales eliminadas' });
    } catch (err) {
      setMessage({ type: 'error', text: err.response?.data?.error || 'Error al eliminar' });
    } finally {
      setDeleting(false);
    }
  };

  const needsSapSetup = requiresSapCredentials() && !hasSapCredentials();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Configuración</h1>
        <p className="text-muted-foreground">Configura tu cuenta y credenciales SAP</p>
      </div>

      {/* Warning banner if SAP credentials needed */}
      {needsSapSetup && (
        <div className="flex items-center gap-3 rounded-lg border border-yellow-200 bg-yellow-50 p-4">
          <AlertTriangle className="h-5 w-5 text-yellow-600" />
          <div>
            <p className="font-medium text-yellow-800">Configura tus credenciales SAP</p>
            <p className="text-sm text-yellow-700">
              Tu rol ({ROLE_LABELS[profile?.role]}) requiere credenciales SAP para realizar operaciones.
            </p>
          </div>
        </div>
      )}

      {/* User Info Card */}
      <Card>
        <CardHeader>
          <CardTitle>Información de Usuario</CardTitle>
          <CardDescription>Tu cuenta y rol en el sistema</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label className="text-muted-foreground">Nombre</Label>
              <p className="font-medium">{user?.firstname} {user?.lastname}</p>
            </div>
            <div>
              <Label className="text-muted-foreground">Email</Label>
              <p className="font-medium">{user?.email}</p>
            </div>
          </div>
          <div>
            <Label className="text-muted-foreground">Rol</Label>
            <div className="flex items-center gap-2 mt-1">
              <Badge variant={profile?.role === 'admin' ? 'default' : 'secondary'}>
                {ROLE_LABELS[profile?.role] || profile?.role}
              </Badge>
              <span className="text-sm text-muted-foreground">
                {ROLE_DESCRIPTIONS[profile?.role]}
              </span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* SAP Credentials Card */}
      <Card>
        <CardHeader>
          <CardTitle>Credenciales SAP</CardTitle>
          <CardDescription>
            {requiresSapCredentials()
              ? 'Tus credenciales de SAP Business One para realizar operaciones'
              : 'Tu rol no requiere credenciales SAP, pero puedes configurarlas si lo deseas'
            }
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Current status */}
          {profile?.sapCredentials?.hasPassword && (
            <div className="flex items-center justify-between rounded-lg border p-3 bg-muted/30">
              <div className="flex items-center gap-3">
                {profile.sapCredentials.lastVerified ? (
                  <CheckCircle className="h-5 w-5 text-green-600" />
                ) : (
                  <AlertTriangle className="h-5 w-5 text-yellow-600" />
                )}
                <div>
                  <p className="font-medium">Usuario SAP: {profile.sapCredentials.username}</p>
                  <p className="text-sm text-muted-foreground">
                    {profile.sapCredentials.lastVerified
                      ? `Verificado: ${new Date(profile.sapCredentials.lastVerified).toLocaleString('es-MX')}`
                      : 'No verificado - prueba la conexión'
                    }
                  </p>
                </div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleDelete}
                disabled={deleting}
                className="text-destructive hover:text-destructive"
              >
                {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              </Button>
            </div>
          )}

          {/* Form to add/update credentials */}
          <form onSubmit={handleSave} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="sap-username">Usuario SAP</Label>
                <Input
                  id="sap-username"
                  placeholder="Tu usuario de SAP B1"
                  value={sapUsername}
                  onChange={(e) => setSapUsername(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="sap-password">
                  {profile?.sapCredentials?.hasPassword ? 'Nueva Contraseña' : 'Contraseña'}
                </Label>
                <div className="relative">
                  <Input
                    id="sap-password"
                    type={showPassword ? 'text' : 'password'}
                    placeholder={profile?.sapCredentials?.hasPassword ? 'Dejar vacío para mantener' : 'Tu contraseña de SAP B1'}
                    value={sapPassword}
                    onChange={(e) => setSapPassword(e.target.value)}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
            </div>

            {/* Message */}
            {message && (
              <div className={`flex items-center gap-2 rounded-lg p-3 ${
                message.type === 'success'
                  ? 'bg-green-50 text-green-800 border border-green-200'
                  : 'bg-red-50 text-red-800 border border-red-200'
              }`}>
                {message.type === 'success'
                  ? <CheckCircle className="h-4 w-4" />
                  : <XCircle className="h-4 w-4" />
                }
                {message.text}
              </div>
            )}

            {/* Actions */}
            <div className="flex gap-3">
              <Button type="submit" disabled={saving || !sapUsername || !sapPassword}>
                {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {profile?.sapCredentials?.hasPassword ? 'Actualizar' : 'Guardar'}
              </Button>
              {profile?.sapCredentials?.hasPassword && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleTest}
                  disabled={testing}
                >
                  {testing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Probar Conexión
                </Button>
              )}
            </div>
          </form>

          <p className="text-xs text-muted-foreground">
            Las credenciales se almacenan encriptadas (AES-256-GCM) y solo se usan para operaciones en SAP.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
