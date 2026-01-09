import { useState, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { locacionesApi } from '../lib/api';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '../components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Plus, MapPin, Building, Edit, Trash2 } from 'lucide-react';
import { useToast } from '../components/ui/toast';

export default function Locations() {
  const [open, setOpen] = useState(false);
  const [editingLocation, setEditingLocation] = useState(null);
  const [selectedType, setSelectedType] = useState('');
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [locationToDelete, setLocationToDelete] = useState(null);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const formRef = useRef(null);
  const queryClient = useQueryClient();
  const toast = useToast();

  const isEditing = !!editingLocation;

  const { data: locations, isLoading } = useQuery({
    queryKey: ['locaciones'],
    queryFn: () => locacionesApi.getAll().then((res) => res.data),
  });

  const { data: tipos } = useQuery({
    queryKey: ['tipos'],
    queryFn: () => locacionesApi.getTipos().then((res) => res.data),
  });

  const createMutation = useMutation({
    mutationFn: locacionesApi.create,
    onSuccess: () => {
      queryClient.invalidateQueries(['locaciones']);
      handleCloseDialog();
      toast.success('Locación creada exitosamente');
    },
    onError: (error) => {
      toast.error(error.response?.data?.error || 'Error al crear locación');
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => locacionesApi.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries(['locaciones']);
      handleCloseDialog();
      toast.success('Locación actualizada exitosamente');
    },
    onError: (error) => {
      toast.error(error.response?.data?.error || 'Error al actualizar locación');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => locacionesApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries(['locaciones']);
      handleCloseDeleteDialog();
      toast.success('Locación eliminada exitosamente');
    },
    onError: (error) => {
      toast.error(error.response?.data?.error || 'Error al eliminar locación');
    },
  });

  const handleCloseDialog = () => {
    setOpen(false);
    setEditingLocation(null);
    setSelectedType('');
    formRef.current?.reset();
  };

  const handleCloseDeleteDialog = () => {
    setDeleteDialogOpen(false);
    setLocationToDelete(null);
    setDeleteConfirmText('');
  };

  const handleDeleteClick = (location) => {
    setLocationToDelete(location);
    setDeleteDialogOpen(true);
  };

  const handleConfirmDelete = () => {
    if (deleteConfirmText.toLowerCase() === 'delete' && locationToDelete) {
      deleteMutation.mutate(locationToDelete._id);
    }
  };

  const handleDialogChange = (isOpen) => {
    if (!isOpen) {
      handleCloseDialog();
    } else {
      setOpen(true);
    }
  };

  const handleEdit = (location) => {
    setEditingLocation(location);
    setSelectedType(location.type);
    setOpen(true);
  };

  const handleSubmit = (e) => {
    e.preventDefault();

    if (!selectedType) {
      toast.warning('Por favor selecciona un tipo de locación');
      return;
    }

    const formData = new FormData(e.target);
    const binAbsEntry = formData.get('sapBinAbsEntry');
    const data = {
      name: formData.get('name'),
      fullName: formData.get('fullName'),
      type: selectedType,
      contact: {
        name: formData.get('contactName'),
        phone: formData.get('contactPhone'),
        email: formData.get('contactEmail'),
      },
      sapIntegration: {
        warehouseCode: formData.get('sapWarehouseCode') || null,
        binAbsEntry: binAbsEntry ? parseInt(binAbsEntry, 10) : null,
        binCode: formData.get('sapBinCode') || null,
      },
    };

    if (isEditing) {
      updateMutation.mutate({ id: editingLocation._id, data });
    } else {
      createMutation.mutate(data);
    }
  };

  if (isLoading) return <div>Cargando...</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Locaciones</h1>
          <p className="text-muted-foreground">Centros y almacenes</p>
        </div>
        <Dialog open={open} onOpenChange={handleDialogChange}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              Nueva Locación
            </Button>
          </DialogTrigger>
          <DialogContent>
            <form ref={formRef} onSubmit={handleSubmit}>
              <DialogHeader>
                <DialogTitle>{isEditing ? 'Editar Locación' : 'Crear Locación'}</DialogTitle>
                <DialogDescription>
                  {isEditing ? 'Modificar información de la locación' : 'Agregar un nuevo centro o almacén'}
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-4 py-4">
                <div className="grid gap-2">
                  <Label htmlFor="name">Nombre Corto *</Label>
                  <Input
                    id="name"
                    name="name"
                    placeholder="CDC"
                    defaultValue={editingLocation?.name || ''}
                    required
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="fullName">Nombre Completo</Label>
                  <Input
                    id="fullName"
                    name="fullName"
                    placeholder="Corazones del Cibao"
                    defaultValue={editingLocation?.fullName || ''}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="type">Tipo *</Label>
                  <Select value={selectedType} onValueChange={setSelectedType} required>
                    <SelectTrigger>
                      <SelectValue placeholder="Seleccionar tipo" />
                    </SelectTrigger>
                    <SelectContent>
                      {tipos?.map((tipo) => (
                        <SelectItem key={tipo.value} value={tipo.value}>
                          {tipo.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2">
                  <Label>Contacto</Label>
                  <Input
                    name="contactName"
                    placeholder="Nombre del contacto"
                    defaultValue={editingLocation?.contact?.name || ''}
                  />
                  <Input
                    name="contactPhone"
                    placeholder="Teléfono"
                    defaultValue={editingLocation?.contact?.phone || ''}
                  />
                  <Input
                    name="contactEmail"
                    type="email"
                    placeholder="Email"
                    defaultValue={editingLocation?.contact?.email || ''}
                  />
                </div>
                <div className="grid gap-2">
                  <Label className="text-muted-foreground">SAP Business One</Label>
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <Label htmlFor="sapWarehouseCode" className="text-xs">Almacén</Label>
                      <Input
                        id="sapWarehouseCode"
                        name="sapWarehouseCode"
                        placeholder="01"
                        defaultValue={editingLocation?.sapIntegration?.warehouseCode || ''}
                      />
                    </div>
                    <div>
                      <Label htmlFor="sapBinAbsEntry" className="text-xs">Bin ID</Label>
                      <Input
                        id="sapBinAbsEntry"
                        name="sapBinAbsEntry"
                        type="number"
                        placeholder="4"
                        defaultValue={editingLocation?.sapIntegration?.binAbsEntry || ''}
                      />
                    </div>
                    <div>
                      <Label htmlFor="sapBinCode" className="text-xs">Bin Code</Label>
                      <Input
                        id="sapBinCode"
                        name="sapBinCode"
                        placeholder="10-CECANOR"
                        defaultValue={editingLocation?.sapIntegration?.binCode || ''}
                      />
                    </div>
                  </div>
                </div>
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={handleCloseDialog}>
                  Cancelar
                </Button>
                <Button type="submit" disabled={createMutation.isPending || updateMutation.isPending}>
                  {createMutation.isPending || updateMutation.isPending
                    ? 'Guardando...'
                    : isEditing
                    ? 'Guardar Cambios'
                    : 'Crear Locación'}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {locations?.map((location) => (
          <Card key={location._id}>
            <CardHeader>
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-2">
                  {location.type === 'WAREHOUSE' ? (
                    <Building className="h-5 w-5 text-muted-foreground" />
                  ) : (
                    <MapPin className="h-5 w-5 text-muted-foreground" />
                  )}
                  <div>
                    <CardTitle className="text-lg">{location.name}</CardTitle>
                    <CardDescription>{location.fullName || location.name}</CardDescription>
                  </div>
                </div>
                <div className="flex gap-1">
                  <Button variant="ghost" size="sm" onClick={() => handleEdit(location)}>
                    <Edit className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:text-destructive"
                    onClick={() => handleDeleteClick(location)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Tipo:</span>
                  <span className="font-medium">
                    {location.type === 'WAREHOUSE' ? 'Almacén' : 'Centro'}
                  </span>
                </div>
                {location.contact?.name && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Contacto:</span>
                    <span className="font-medium">{location.contact.name}</span>
                  </div>
                )}
                {location.contact?.phone && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Teléfono:</span>
                    <span className="font-medium">{location.contact.phone}</span>
                  </div>
                )}
                {location.sapIntegration?.binCode && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">SAP:</span>
                    <span className="font-medium font-mono text-xs">
                      {location.sapIntegration.binCode}
                    </span>
                  </div>
                )}
                {location.sapIntegration?.warehouseCode && !location.sapIntegration?.binCode && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">SAP Almacén:</span>
                    <span className="font-medium font-mono text-xs">
                      {location.sapIntegration.warehouseCode}
                    </span>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {locations?.length === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <MapPin className="h-12 w-12 text-muted-foreground mb-4" />
            <p className="text-lg font-medium">No hay locaciones</p>
            <p className="text-sm text-muted-foreground">Comienza creando tu primera locación</p>
          </CardContent>
        </Card>
      )}

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteDialogOpen} onOpenChange={(isOpen) => !isOpen && handleCloseDeleteDialog()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Eliminar Locación</DialogTitle>
            <DialogDescription>
              ¿Estás seguro que deseas eliminar <strong>{locationToDelete?.name}</strong>?
              Esta acción no se puede deshacer.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="deleteConfirm">
                Escribe <span className="font-mono font-bold">delete</span> para confirmar:
              </Label>
              <Input
                id="deleteConfirm"
                value={deleteConfirmText}
                onChange={(e) => setDeleteConfirmText(e.target.value)}
                placeholder="delete"
                autoComplete="off"
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={handleCloseDeleteDialog}>
              Cancelar
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={handleConfirmDelete}
              disabled={deleteConfirmText.toLowerCase() !== 'delete' || deleteMutation.isPending}
            >
              {deleteMutation.isPending ? 'Eliminando...' : 'Eliminar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
