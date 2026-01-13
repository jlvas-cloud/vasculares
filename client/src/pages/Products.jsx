import { useState, useRef, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { productosApi } from '../lib/api';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '../components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Plus, Package, Edit, AlertCircle } from 'lucide-react';
import { Switch } from '../components/ui/switch';
import { useToast } from '../components/ui/toast';

export default function Products() {
  const [open, setOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState(null);
  const [selectedCategory, setSelectedCategory] = useState('');
  const [isActive, setIsActive] = useState(true);
  const formRef = useRef(null);
  const queryClient = useQueryClient();
  const toast = useToast();

  const isEditing = !!editingProduct;

  const { data: products, isLoading } = useQuery({
    queryKey: ['productos'],
    queryFn: () => productosApi.getAll().then((res) => res.data),
  });

  const { data: categorias } = useQuery({
    queryKey: ['categorias'],
    queryFn: () => productosApi.getCategorias().then((res) => res.data),
  });

  const createMutation = useMutation({
    mutationFn: productosApi.create,
    onSuccess: () => {
      queryClient.invalidateQueries(['productos']);
      handleCloseDialog();
      toast.success('Producto creado exitosamente');
    },
    onError: (error) => {
      toast.error(error.response?.data?.error || 'Error al crear producto');
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => productosApi.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries(['productos']);
      handleCloseDialog();
      toast.success('Producto actualizado exitosamente');
    },
    onError: (error) => {
      toast.error(error.response?.data?.error || 'Error al actualizar producto');
    },
  });

  const handleCloseDialog = () => {
    setOpen(false);
    setEditingProduct(null);
    setSelectedCategory('');
    setIsActive(true);
    formRef.current?.reset();
  };

  const handleDialogChange = (isOpen) => {
    if (!isOpen) {
      handleCloseDialog();
    } else {
      setOpen(true);
    }
  };

  const handleEdit = (product) => {
    setEditingProduct(product);
    setSelectedCategory(product.category);
    setIsActive(product.active !== false); // default to true if undefined
    setOpen(true);
  };

  const handleSubmit = (e) => {
    e.preventDefault();

    if (!selectedCategory) {
      toast.warning('Por favor selecciona una categoría');
      return;
    }

    const formData = new FormData(e.target);

    const specifications = {};
    const diameter = formData.get('diameter');
    const length = formData.get('length');
    const type = formData.get('type');

    if (diameter) specifications.diameter = parseFloat(diameter);
    if (length) specifications.length = parseFloat(length);
    if (diameter && length) {
      specifications.size = `${diameter}/${length}`;
    }
    if (type) specifications.type = type;

    const data = {
      name: formData.get('name'),
      code: parseInt(formData.get('code')),
      category: selectedCategory,
      subcategory: formData.get('subcategory') || undefined,
      active: isActive,
    };

    if (Object.keys(specifications).length > 0) {
      data.specifications = specifications;
    }

    if (isEditing) {
      updateMutation.mutate({ id: editingProduct._id, data });
    } else {
      createMutation.mutate(data);
    }
  };

  if (isLoading) return <div>Cargando...</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Productos</h1>
          <p className="text-muted-foreground">Catálogo de productos vasculares</p>
        </div>
        <Dialog open={open} onOpenChange={handleDialogChange}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              Nuevo Producto
            </Button>
          </DialogTrigger>
          <DialogContent>
            <form ref={formRef} onSubmit={handleSubmit}>
              <DialogHeader>
                <DialogTitle>{isEditing ? 'Editar Producto' : 'Crear Producto'}</DialogTitle>
                <DialogDescription>
                  {isEditing ? 'Modificar información del producto' : 'Agregar un nuevo producto al catálogo'}
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-4 py-4">
                <div className="grid gap-2">
                  <Label htmlFor="name">Nombre *</Label>
                  <Input
                    id="name"
                    name="name"
                    placeholder="Orsiro 2.25/13"
                    defaultValue={editingProduct?.name || ''}
                    required
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="code">Código *</Label>
                  <Input
                    id="code"
                    name="code"
                    type="number"
                    placeholder="364475"
                    defaultValue={editingProduct?.code || ''}
                    required
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="category">Categoría *</Label>
                  <Select value={selectedCategory} onValueChange={setSelectedCategory} required>
                    <SelectTrigger>
                      <SelectValue placeholder="Seleccionar categoría" />
                    </SelectTrigger>
                    <SelectContent>
                      {categorias?.map((cat) => (
                        <SelectItem key={cat.value} value={cat.value}>
                          {cat.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="subcategory">Subcategoría</Label>
                  <Input
                    id="subcategory"
                    name="subcategory"
                    placeholder="Orsiro"
                    defaultValue={editingProduct?.subcategory || ''}
                  />
                </div>
                {isEditing && (
                  <div className="flex items-center justify-between rounded-lg border p-3">
                    <div className="space-y-0.5">
                      <Label htmlFor="active">Producto Activo</Label>
                      <p className="text-sm text-muted-foreground">
                        Desactivar para ocultar de listas y reportes
                      </p>
                    </div>
                    <Switch
                      id="active"
                      checked={isActive}
                      onCheckedChange={setIsActive}
                    />
                  </div>
                )}
                <div className="grid grid-cols-3 gap-4">
                  <div className="grid gap-2">
                    <Label htmlFor="diameter">Diametro (mm)</Label>
                    <Input
                      id="diameter"
                      name="diameter"
                      type="number"
                      step="0.25"
                      min="0"
                      placeholder="2.25"
                      defaultValue={editingProduct?.specifications?.diameter || ''}
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="length">Longitud (mm)</Label>
                    <Input
                      id="length"
                      name="length"
                      type="number"
                      min="0"
                      placeholder="13"
                      defaultValue={editingProduct?.specifications?.length || ''}
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="type">Tipo</Label>
                    <Input
                      id="type"
                      name="type"
                      placeholder="Regular"
                      defaultValue={editingProduct?.specifications?.type || ''}
                    />
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
                    : 'Crear Producto'}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {products?.map((product) => (
          <Card key={product._id} className={product.active === false ? 'opacity-60' : ''}>
            <CardHeader>
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-2">
                  <Package className="h-5 w-5 text-muted-foreground" />
                  <div>
                    <CardTitle className="text-lg flex items-center gap-2">
                      {product.name}
                      {product.active === false && (
                        <span className="text-xs bg-muted text-muted-foreground px-2 py-0.5 rounded">
                          Inactivo
                        </span>
                      )}
                    </CardTitle>
                    <CardDescription>Código: {product.code}</CardDescription>
                  </div>
                </div>
                <Button variant="ghost" size="sm" onClick={() => handleEdit(product)}>
                  <Edit className="h-4 w-4" />
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Categoría:</span>
                  <span className="font-medium">
                    {product.category === 'GUIAS' ? 'Guías' : 'Stents Coronarios'}
                  </span>
                </div>
                {product.subcategory && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Subcategoría:</span>
                    <span className="font-medium">{product.subcategory}</span>
                  </div>
                )}
                {(product.specifications?.diameter || product.specifications?.size) && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Tamaño:</span>
                    <span className="font-medium">
                      {product.specifications?.diameter && product.specifications?.length
                        ? `${product.specifications.diameter}/${product.specifications.length}`
                        : product.specifications?.size}
                    </span>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {products?.length === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Package className="h-12 w-12 text-muted-foreground mb-4" />
            <p className="text-lg font-medium">No hay productos</p>
            <p className="text-sm text-muted-foreground">Comienza creando tu primer producto</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
