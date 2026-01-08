import { useState, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { locacionesApi } from '../lib/api';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '../components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Plus, MapPin, Building } from 'lucide-react';
import { useToast } from '../components/ui/toast';

export default function Locations() {
  const [open, setOpen] = useState(false);
  const [selectedType, setSelectedType] = useState('');
  const formRef = useRef(null);
  const queryClient = useQueryClient();
  const toast = useToast();

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
      formRef.current?.reset();
      setSelectedType('');
      setOpen(false);
      toast.success('Locación creada exitosamente');
    },
    onError: (error) => {
      toast.error(error.response?.data?.error || 'Error al crear locación');
    },
  });

  const handleDialogChange = (isOpen) => {
    setOpen(isOpen);
    if (!isOpen) {
      formRef.current?.reset();
      setSelectedType('');
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();

    if (!selectedType) {
      toast.warning('Por favor selecciona un tipo de locación');
      return;
    }

    const formData = new FormData(e.target);
    const data = {
      name: formData.get('name'),
      fullName: formData.get('fullName'),
      type: selectedType,
      contact: {
        name: formData.get('contactName'),
        phone: formData.get('contactPhone'),
        email: formData.get('contactEmail'),
      },
    };
    createMutation.mutate(data);
  };

  if (isLoading) return <div>Cargando...</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Locaciones</h1>
          <p className="text-muted-foreground">Hospitales y almacenes</p>
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
                <DialogTitle>Crear Locación</DialogTitle>
                <DialogDescription>Agregar un nuevo hospital o almacén</DialogDescription>
              </DialogHeader>
              <div className="grid gap-4 py-4">
                <div className="grid gap-2">
                  <Label htmlFor="name">Nombre Corto *</Label>
                  <Input id="name" name="name" placeholder="CDC" required />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="fullName">Nombre Completo</Label>
                  <Input id="fullName" name="fullName" placeholder="Corazones del Cibao" />
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
                  <Input name="contactName" placeholder="Nombre del contacto" />
                  <Input name="contactPhone" placeholder="Teléfono" />
                  <Input name="contactEmail" type="email" placeholder="Email" />
                </div>
              </div>
              <DialogFooter>
                <Button type="submit" disabled={createMutation.isPending}>
                  {createMutation.isPending ? 'Creando...' : 'Crear Locación'}
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
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Tipo:</span>
                  <span className="font-medium">
                    {location.type === 'WAREHOUSE' ? 'Almacén' : location.type === 'HOSPITAL' ? 'Hospital' : 'Clínica'}
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
    </div>
  );
}
