-- El acceso a Inventario no es un todo-o-nada: "Insumos clínicos" lo maneja
-- recepción (Laura, Camila Monsalve) e "Insumos generales" las auxiliares de
-- odontología (Angie, Bertha, Michelle, Camila Hernández) — cada quien ve
-- solo su pestaña. Reemplaza el puede_inventario genérico de la migración
-- anterior, que además tenía un bug: AuthContext nunca lo traía del
-- servidor, así que no le funcionaba a nadie.
alter table perfiles add column puede_inventario_clinico boolean not null default false;
alter table perfiles add column puede_inventario_general boolean not null default false;

update perfiles set puede_inventario_clinico = true
  where nombre in ('Laura Pulgarin', 'Maria Camila Monsalve');

update perfiles set puede_inventario_general = true
  where nombre in ('Angie Mendez', 'Bertha Cabeza', 'Michelle Garcia', 'Maria Camila Hernandez');

alter table perfiles drop column puede_inventario;
