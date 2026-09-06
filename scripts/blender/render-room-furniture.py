"""Render selectable thumbnails and save the editable Blender source after generation."""
import bpy, math
from pathlib import Path
from mathutils import Vector
out=Path(INVENTORY_PROJECT_DIR)/'public/models/room-furniture/v2'
assets=Path(INVENTORY_PROJECT_DIR)/'assets/room-furniture/v2'
assets.mkdir(parents=True,exist_ok=True)
scene=bpy.context.scene
models=[obj for obj in bpy.data.collections['Inventory Furniture'].objects if obj.get('variant')]
for obj in list(bpy.data.objects):
    if obj.type in {'CAMERA','LIGHT'} or obj.name=='Cube':
        bpy.data.objects.remove(obj,do_unlink=True)
for model in models: model.location=(0,0,0)
scene.render.engine='CYCLES'
scene.cycles.samples=32
scene.cycles.use_denoising=True
scene.render.resolution_x=320; scene.render.resolution_y=320; scene.render.resolution_percentage=100
scene.render.image_settings.file_format='PNG'; scene.render.image_settings.color_mode='RGBA'
scene.render.film_transparent=True
scene.world.use_nodes=True
scene.world.node_tree.nodes['Background'].inputs[0].default_value=(.65,.70,.8,1)
scene.world.node_tree.nodes['Background'].inputs[1].default_value=.35
scene.view_settings.view_transform='AgX'
for name,location,power,size in [('Key',(3,-4,6),550,4),('Fill',(-3,-1,3),260,3),('Rim',(1,4,4),400,3)]:
    data=bpy.data.lights.new(name,'AREA'); data.energy=power; data.shape='DISK'; data.size=size
    light=bpy.data.objects.new(name,data); scene.collection.objects.link(light); light.location=location
    light.rotation_euler=(-light.location).to_track_quat('-Z','Y').to_euler()
camera_data=bpy.data.cameras.new('Furniture preview camera'); camera_data.type='ORTHO'
camera=bpy.data.objects.new('Furniture preview camera',camera_data); scene.collection.objects.link(camera); scene.camera=camera
camera.location=(3,-4,2.7); camera.rotation_euler=(-camera.location).to_track_quat('-Z','Y').to_euler()
for model in models:
    for other in models:
        for part in other.children: part.hide_render=other!=model
    dims=model['nominalDimensions']
    camera_data.ortho_scale=max(dims)*1.65
    scene.render.filepath=str(out/(model['variant']+'.png'))
    bpy.ops.render.render(write_still=True)
for index,model in enumerate(models):
    for part in model.children: part.hide_render=False
    model.location=((index%6)*3.3,(index//6)*3.3,model['nominalDimensions'][1]/2)
scene.render.film_transparent=False
# Light the complete arranged catalog evenly, not just the models at the origin.
center=Vector((8.25,9.9,0))
for obj in scene.objects:
    if obj.type=='LIGHT':
        obj.location=center+(obj.location-center).normalized()*23+Vector((0,0,15))
        obj.rotation_euler=(center-obj.location).to_track_quat('-Z','Y').to_euler()
        obj.data.energy=6500; obj.data.size=16
scene.world.node_tree.nodes['Background'].inputs[0].default_value=(.7,.73,.78,1)
scene.world.node_tree.nodes['Background'].inputs[1].default_value=.65
camera.location=(18,-20,24); target=Vector((8,10,0)); camera.rotation_euler=(target-camera.location).to_track_quat('-Z','Y').to_euler()
camera_data.ortho_scale=32
scene.render.resolution_x=1600; scene.render.resolution_y=1200
scene.render.filepath=str(assets/'catalog.png')
bpy.ops.render.render(write_still=True)
bpy.ops.wm.save_as_mainfile(filepath=str(assets/'furniture.blend'),compress=True)
print(f'Rendered {len(models)} model thumbnails and saved editable furniture.blend')
