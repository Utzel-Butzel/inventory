"""Original furniture library, authored via Blender MCP. Logical axes: X/Y-up/Z-front.
Run from the project root: node scripts/blender/mcp-client.mjs scripts/blender/generate-room-furniture.py
No downloaded or third-party furniture assets are used.
"""
import bpy, math, json, random
from pathlib import Path
from mathutils import Vector

OUT = Path(INVENTORY_PROJECT_DIR) / 'public/models/room-furniture/v1'
OUT.mkdir(parents=True, exist_ok=True)
collection = bpy.data.collections.get('Inventory Furniture')
if collection:
    for obj in list(collection.objects): bpy.data.objects.remove(obj, do_unlink=True)
else:
    collection = bpy.data.collections.new('Inventory Furniture')
    bpy.context.scene.collection.children.link(collection)

def texture(name, fabric=False):
    image = bpy.data.images.new(name, width=256, height=256)
    rng = random.Random(52 if fabric else 71)
    pixels = []
    for y in range(256):
        for x in range(256):
            if fabric:
                v = .78 + .09 * math.sin(x * math.pi / 2) * math.cos(y * math.pi / 2) + rng.random() * .06
            else:
                grain = math.sin(x * .18 + math.sin(y * .028) * 2) + .4 * math.sin(x * .74 + math.sin(y * .014) * 4)
                v = .80 + grain * .065 + rng.random() * .025
            pixels.extend([v, v, v, 1])
    image.pixels = pixels
    image.pack()
    return image

wood_texture, fabric_texture = texture('Oak grain'), texture('Woven fabric', True)
def mat(name, rgb, rough=.6, metallic=0, weave=None, tint=False):
    material = bpy.data.materials.new(name)
    material.diffuse_color = (*rgb, 1)
    material.use_nodes = True
    material['inventoryTintable'] = tint
    material['inventoryFinish'] = 'fabric' if weave == 'fabric' else 'wood' if weave else name
    bsdf = material.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = (*rgb, 1)
    bsdf.inputs['Roughness'].default_value = rough
    bsdf.inputs['Metallic'].default_value = metallic
    if weave:
        tex = material.node_tree.nodes.new('ShaderNodeTexImage')
        tex.image = fabric_texture if weave == 'fabric' else wood_texture
        # Bake the base colour into the small shared image: portable glTF PBR.
        coloured = tex.image.copy()
        coloured.name = name + ' texture'
        values = list(coloured.pixels)
        for i in range(0,len(values),4):
            for a in range(3): values[i+a] *= rgb[a]
        coloured.pixels = values
        coloured.pack()
        tex.image = coloured
        material.node_tree.links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
    return material

oak=mat('Oak',(.64,.44,.25),.5,weave='wood',tint=True)
walnut=mat('Walnut',(.24,.13,.075),.48,weave='wood',tint=True)
ivory=mat('Paint',(.82,.82,.77),.48,tint=True)
fabric=mat('Upholstery',(.34,.45,.42),.92,weave='fabric',tint=True)
soft=mat('Cushion',(.68,.66,.59),.95,weave='fabric',tint=True)
linen=mat('Linen',(.82,.80,.74),.95,weave='fabric')
steel=mat('Steel',(.38,.42,.44),.3,.85)
black=mat('Powder coat',(.035,.044,.05),.5,.35)
chrome=mat('Chrome',(.7,.73,.75),.22,1)
ceramic=mat('Ceramic',(.91,.91,.88),.22)
glass=mat('Smoked glass',(.035,.065,.075),.17,.15)
inside=mat('Interior shadow',(.10,.11,.12),.75)

root=None
def attach(obj, name, material):
    obj.name=name
    for c in list(obj.users_collection): c.objects.unlink(obj)
    collection.objects.link(obj)
    obj.parent=root
    obj.data.materials.append(material)
    return obj

def point(p): return (p[0], -p[2], p[1])
def box(name, size, pos, material=oak, bevel=.006):
    bpy.ops.mesh.primitive_cube_add(size=1, location=point(pos))
    obj=attach(bpy.context.object,name,material)
    obj.scale=(size[0],size[2],size[1])
    bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    if bevel:
        modifier=obj.modifiers.new('Soft manufactured edges','BEVEL')
        modifier.width=min(bevel,min(size)*.22); modifier.segments=3
        bpy.ops.object.modifier_apply(modifier=modifier.name)
        modifier=obj.modifiers.new('Weighted corner normals','WEIGHTED_NORMAL')
        bpy.ops.object.modifier_apply(modifier=modifier.name)
    return obj

def cylinder(name,radius,height,pos,material=steel,axis='y',vertices=24):
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices,radius=radius,depth=height,location=point(pos))
    obj=attach(bpy.context.object,name,material)
    if axis=='x': obj.rotation_euler[1]=math.pi/2
    if axis=='z': obj.rotation_euler[0]=math.pi/2
    for face in obj.data.polygons: face.use_smooth = len(face.vertices)==4
    bevel=obj.modifiers.new('Edge highlight','BEVEL'); bevel.width=min(.003,radius*.12); bevel.segments=2
    bpy.context.view_layer.objects.active=obj
    bpy.ops.object.modifier_apply(modifier=bevel.name)
    return obj

def ellipsoid(name,size,pos,material=soft):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=24,ring_count=12,radius=.5,location=point(pos))
    obj=attach(bpy.context.object,name,material); obj.scale=(size[0],size[2],size[1])
    bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    for face in obj.data.polygons: face.use_smooth=True
    return obj

def bar(name,a,b,r=.012,material=steel):
    start,end=Vector(point(a)),Vector(point(b))
    bpy.ops.mesh.primitive_cylinder_add(vertices=12,radius=r,depth=(end-start).length,location=(start+end)/2)
    obj=attach(bpy.context.object,name,material)
    obj.rotation_euler=(end-start).to_track_quat('Z','Y').to_euler()
    for face in obj.data.polygons: face.use_smooth=len(face.vertices)==4
    return obj

def legs(w,d,top,bottom=0,material=oak,r=.025):
    for x in [-w*.41,w*.41]:
        for z in [-d*.38,d*.38]: bar('Tapered leg',(x,bottom+r,z),(x,top,z),r,material)

def handle(x,y,z,width=.18):
    for a in [-width/2,width/2]: cylinder('Handle mount',.008,.026,(x+a,y,z+.013),chrome,'z',12)
    cylinder('Handle',.009,width,(x,y,z+.03),chrome,'x',16)

def cabinet(w,h,d,variant):
    p=.025; base=.09 if h<1.4 else .055
    if variant=='wall-shelf':
        for y in [h*.18,h*.55,h-.02]:
            box('Floating shelf',(w,p,d),(0,y,0))
            for x in [-w*.36,w*.36]: box('Bracket',(.018,h*.15,.018),(x,y-h*.075,-d*.4),black)
        return
    if variant=='shelving':
        for x in [-w/2+p,w/2-p]:
            for z in [-d/2+p,d/2-p]: box('Powder coated upright',(p,h,p),(x,h/2,z),black)
        for i in range(5): box('Steel shelf',(w,.026,d),(0,.05+(h-.08)*i/4,0),steel)
        bar('Diagonal brace',(-w*.46,.09,-d*.44),(w*.46,h-.06,-d*.44),.007,black)
        return
    for x in [-w/2+p/2,w/2-p/2]: box('Side panel',(p,h-base,d),(x,(h+base)/2,0),oak)
    for y in [base,h-p/2]: box('Carcass horizontal',(w,p,d),(0,y,0),oak)
    box('Back panel',(w-p*2,h-base,.012),(0,(h+base)/2,-d/2+.006),walnut)
    if base>.07: legs(w,d,base,material=black,r=.018)
    else: box('Recessed plinth',(w-.06,base,d-.08),(0,base/2,-.01),inside)
    if variant in ['bookcase','cube-shelf']:
        count=4 if variant=='cube-shelf' else 6
        for i in range(1,count): box('Shelf',(w-p*2,p,d-p),(0,base+(h-base)*i/count,0))
        cols=3 if variant=='cube-shelf' else 2
        for i in range(1,cols): box('Shelf divider',(p,h-base,d-p),(-w/2+w*i/cols,(h+base)/2,0))
    elif variant=='drawers':
        for i in range(4):
            dh=(h-base-.025)/4; y=base+dh*(i+.5)
            box('Drawer front',(w-.07,dh-.012,.024),(0,y,d/2+.003),ivory)
            handle(0,y+.035,d/2+.016,w*.28)
    else:
        count=3 if variant=='sideboard' else 2
        for i in range(count):
            dw=(w-.045)/count; x=-w/2+.0225+dw*(i+.5)
            z=d/2+(.008 if variant!='sliding-wardrobe' else .008+i*.012)
            box('Sliding door' if variant=='sliding-wardrobe' else 'Door',(dw-.009,h-base-.038,.022),(x,(h+base)/2,z),ivory if variant in ['wardrobe','kitchen-cabinet'] else oak)
            if variant=='sliding-wardrobe': box('Recessed pull',(.012,h*.15,.009),(x+dw*.39,h*.47,z+.014),black)
            else: handle(x,h*.52,z+.013,min(.18,dw*.5))
        if variant=='sliding-wardrobe':
            for y in [base+.02,h-.025]: box('Door track',(w-.04,.012,.042),(0,y,d/2+.018),steel)
        if variant=='kitchen-cabinet': box('Stone worktop',(w+.015,.038,d+.04),(0,h+.018,.005),ceramic)

def table(w,h,d,variant):
    if variant=='round-table':
        cylinder('Round solid top',w/2,.045,(0,h-.023,0),oak)
        cylinder('Pedestal',.055,h-.06,(0,(h-.06)/2,0),black)
        cylinder('Stable disc base',w*.28,.022,(0,.011,0),black)
    else:
        box('Tabletop',(w,.045,d),(0,h-.0225,0),oak,.013)
        legs(w,d,h-.045,material=black if variant in ['desk','coffee-table'] else walnut)
        if variant=='desk':
            box('Modesty rail',(w*.84,.09,.025),(0,h-.12,-d*.32),black)
            box('Drawer',(w*.3,.12,d*.55),(w*.27,h-.11,.05),ivory)
            handle(w*.27,h-.11,d*.275+.065,w*.12)
        else:
            for z in [-d*.35,d*.35]: box('Apron',(w*.85,.085,.02),(0,h-.085,z),walnut)

def seat(w,h,d,variant):
    sh=.46 if variant not in ['stool','bench'] else h-.045
    if variant=='office-chair':
        cylinder('Gas lift',.032,.34,(0,.23,0),chrome)
        for i in range(5):
            angle=i*math.tau/5; x,z=math.cos(angle)*w*.43,math.sin(angle)*d*.43
            bar('Five-star base',(0,.14,0),(x,.08,z),.025,black)
            cylinder('Caster',.038,.045,(x,.045,z),black,'x',16)
        box('Upholstered seat',(w*.88,.085,d*.78),(0,sh,0),fabric,.035)
        box('Support spine',(.09,h-sh,.04),(0,(h+sh)/2,-d*.38),black)
        box('Ergonomic back',(w*.78,h-sh-.04,.10),(0,(h+sh)/2,-d*.36),fabric,.045)
        for x in [-w*.44,w*.44]:
            bar('Arm support',(x,sh,-d*.16),(x,sh+.2,-d*.16),.012,black)
            box('Armrest',(.07,.04,d*.48),(x,sh+.22,0),black,.018)
    else:
        legs(w,d,sh-.025,material=walnut,r=.022)
        box('Seat',(w,.05,d),(0,sh,0),oak,.018)
        if variant=='chair':
            for x in [-w*.40,w*.40]: bar('Back upright',(x,sh,-d*.38),(x,h-.035,-d*.43),.022,walnut)
            for i in range(3): box('Back slat',(w*.84,.065,.025),(0,h-.055-i*.087,-d*.42),oak,.012)

def sofa(w,h,d,variant):
    corner=variant=='corner-sofa'; count=1 if variant=='armchair' else 3 if w>2 else 2
    legs(w,d,.14,material=black,r=.022)
    box('Upholstered base',(w,.24,d*.89),(0,.24,0),fabric,.04)
    box('Back frame',(w-.05,h-.29,.17),(0,(h+.29)/2,-d*.4),fabric,.045)
    for x in [-w/2+.085,w/2-.085]: box('Soft arm',(.17,h*.64,d*.85),(x,h*.39,0),fabric,.055)
    usable=w-.38; cw=usable/count
    for i in range(count):
        x=-usable/2+cw*(i+.5)
        box('Seat cushion',(cw-.018,.14,d*.62),(x,.43,d*.10),soft,.052)
        box('Back cushion',(cw-.024,h*.42,.14),(x,h*.69,-d*.26),soft,.048)
        # Fine contrasting welt lines make the cushion boundaries legible.
        box('Cushion welt',(cw-.08,.006,.006),(x,.476,d*.405),linen,.002)
    if corner:
        box('Chaise base',(w*.34,.27,d*.65),(-w*.31,.25,d*.63),fabric,.045)
        box('Chaise cushion',(w*.32,.14,d*.61),(-w*.31,.43,d*.63),soft,.045)
        legs(w*.34,d*.65,.14,material=black)
    ellipsoid('Loose pillow',(min(.38,w*.32),.34,.13),(-w*.26,h*.65,-d*.14),linen)

def bed(w,h,d,variant):
    bunk=variant=='bunk-bed'; levels=[.45,1.5] if bunk else [.30]
    for level in levels:
        box('Bed frame',(w,.15,d),(0,level-.075,0),oak,.014)
        box('Mattress',(w-.07,.19,d-.08),(0,level+.095,0),linen,.06)
        box('Duvet',(w-.055,.055,d*.62),(0,level+.207,d*.14),soft,.025)
        for x in ([-w*.24,w*.24] if w>1.2 else [0]): ellipsoid('Pillow',(w*.39 if w>1.2 else w*.78,.12,.43),(x,level+.25,-d*.32),linen)
    if bunk:
        for x in [-w/2+.03,w/2-.03]:
            for z in [-d/2+.035,d/2-.035]: box('Bedpost',(.065,h,.065),(x,h/2,z),oak)
        for z in [-d*.46,d*.46]:
            for y in [1.79,1.94]: box('Safety rail',(w,.05,.026),(0,y,z),oak)
        for x in [w*.17,w*.44]: box('Ladder upright',(.035,1.6,.04),(x,.8,d*.52),oak)
        for i in range(5): box('Ladder rung',(w*.27,.032,.055),(w*.305,.2+i*.3,d*.52),oak)
    else:
        box('Upholstered headboard',(w,h,.08),(0,h/2,-d*.49),fabric,.035)
        legs(w,d,.24,material=walnut)

def appliance(w,h,d,variant):
    box('Appliance body',(w,h,d),(0,h/2,0),ivory,.018)
    z=d/2+.008
    if variant=='refrigerator':
        for y,dh in [(h*.665,h*.62),(h*.175,h*.31)]:
            box('Insulated door',(w-.025,dh,.025),(0,y,z),steel,.012)
            cylinder('Vertical handle',.012,dh*.45,(w*.36,y,z+.04),chrome)
    elif variant=='washer':
        box('Control fascia',(w-.035,.12,.018),(0,h-.08,z),ivory)
        cylinder('Program dial',.03,.022,(-w*.28,h-.08,z+.02),chrome,'z')
        box('Display',(.16,.037,.01),(w*.19,h-.08,z+.022),glass)
        cylinder('Door rim',w*.35,.035,(0,h*.45,z+.02),chrome,'z',48)
        cylinder('Rubber gasket',w*.31,.04,(0,h*.45,z+.043),black,'z',48)
        cylinder('Glass porthole',w*.265,.025,(0,h*.45,z+.068),glass,'z',48)
    elif variant=='oven':
        box('Glass oven door',(w*.87,h*.69,.03),(0,h*.39,z),glass,.008)
        handle(0,h*.70,z+.02,w*.7)
        for x in [-w*.28,w*.28]: cylinder('Control dial',.03,.025,(x,h*.9,z+.022),chrome,'z')
        box('Digital display',(w*.24,.04,.008),(0,h*.9,z+.023),glass)
    else:
        box('Dishwasher door',(w-.028,h-.07,.02),(0,h*.48,z),steel)
        handle(0,h*.88,z+.016,w*.64)
        box('Control panel',(w*.48,.028,.009),(0,h*.94,z+.014),glass)

def bathroom(w,h,d,variant):
    if variant=='toilet':
        ellipsoid('Pedestal',(w*.58,h*.6,d*.6),(0,h*.30,d*.04),ceramic)
        ellipsoid('Bowl',(w,h*.38,d*.82),(0,h*.49,d*.08),ceramic)
        ellipsoid('Seat',(w*.94,.035,d*.7),(0,h*.685,d*.13),ivory)
        box('Cistern',(w*.83,h*.48,d*.22),(0,h*.76,-d*.39),ceramic,.045)
        cylinder('Flush button',.022,.009,(0,h+.005,-d*.38),chrome)
    elif variant=='sink':
        box('Vanity base',(w,.65,d),(0,.325,0),oak)
        for x in [-w*.24,w*.24]:
            box('Vanity door',(w*.46,.59,.024),(x,.34,d/2+.008),ivory)
            handle(x,.55,d/2+.025,w*.15)
        box('Basin bottom',(w,.065,d),(0,h-.16,0),ceramic,.024)
        for x in [-w/2+.035,w/2-.035]: box('Basin side',(.07,.14,d),(x,h-.06,0),ceramic,.018)
        for z in [-d/2+.035,d/2-.035]: box('Basin rim',(w-.12,.14,.07),(0,h-.06,z),ceramic,.018)
        cylinder('Tap stem',.018,.17,(0,h+.035,-d*.36),chrome)
        cylinder('Tap spout',.016,.14,(0,h+.115,-d*.25),chrome,'z')
    else:
        box('Tub base',(w*.9,.09,d*.9),(0,.07,0),ceramic,.035)
        for x in [-w/2+.055,w/2-.055]: box('Tub side',(.11,h,d),(x,h/2,0),ceramic,.048)
        for z in [-d/2+.07,d/2-.07]: box('Tub end',(w,.98*h,.14),(0,h/2,z),ceramic,.052)
        cylinder('Drain',.023,.004,(0,.118,-d*.30),chrome)
        cylinder('Bath tap',.02,.15,(w*.43,h+.075,-d*.32),chrome)
        cylinder('Bath spout',.018,.16,(w*.35,h+.145,-d*.32),chrome,'x')

SPECS=[
 ('wardrobe','storage',(1.6,2.2,.6)),('sliding-wardrobe','storage',(2,2.2,.65)),
 ('bookcase','storage',(1.2,2.05,.34)),('cube-shelf','storage',(1.45,1.45,.37)),
 ('shelving','storage',(1.1,1.9,.5)),('wall-shelf','storage',(1.1,.85,.26)),
 ('sideboard','storage',(1.8,.82,.44)),('drawers','storage',(.85,1.05,.47)),('kitchen-cabinet','storage',(1.2,.9,.6)),
 ('table','table',(1.7,.76,.88)),('round-table','table',(1.1,.75,1.1)),('desk','table',(1.5,.75,.72)),('coffee-table','table',(1.1,.42,.6)),
 ('chair','chair',(.46,.9,.49)),('office-chair','chair',(.65,1.1,.66)),('stool','chair',(.4,.47,.4)),('bench','chair',(1.2,.46,.38)),
 ('sofa','sofa',(2.15,.87,.9)),('corner-sofa','sofa',(2.65,.9,1.0)),('armchair','chair',(.88,.88,.85)),
 ('bed','bed',(1.8,1.08,2.08)),('single-bed','bed',(.95,1.0,2.03)),('bunk-bed','bed',(1.02,2.0,2.06)),
 ('refrigerator','refrigerator',(.7,1.9,.7)),('washer','washer-dryer',(.6,.85,.6)),('oven','oven',(.6,.6,.58)),('dishwasher','dishwasher',(.6,.84,.6)),
 ('toilet','toilet',(.38,.78,.66)),('sink','sink',(.8,.84,.49)),('bathtub','bathtub',(.76,.57,1.7)),
]
roots=[]; manifest=[]
for variant,category,(w,h,d) in SPECS:
    root=bpy.data.objects.new(variant,None); collection.objects.link(root)
    root['variant']=variant; root['category']=category
    if category=='storage': cabinet(w,h,d,variant)
    elif category=='table': table(w,h,d,variant)
    elif variant in ['sofa','corner-sofa','armchair']: sofa(w,h,d,variant)
    elif category=='chair': seat(w,h,d,variant)
    elif category=='bed': bed(w,h,d,variant)
    elif category in ['toilet','sink','bathtub']: bathroom(w,h,d,variant)
    else: appliance(w,h,d,variant)
    bpy.context.view_layer.update()
    vertices=[obj.matrix_world @ Vector(corner) for obj in root.children for corner in obj.bound_box]
    low=Vector(tuple(min(v[a] for v in vertices) for a in range(3)))
    high=Vector(tuple(max(v[a] for v in vertices) for a in range(3)))
    center=(low+high)/2
    for obj in root.children: obj.location-=center
    nominal=[round(high.x-low.x,5),round(high.z-low.z,5),round(high.y-low.y,5)]
    root['nominalDimensions']=nominal
    triangles=sum(len(obj.data.polygons) for obj in root.children)*2
    roots.append(root); manifest.append({'id':variant,'category':category,'dimensions':nominal,'parts':len(root.children),'triangleEstimate':triangles})

bpy.ops.object.select_all(action='DESELECT')
for obj in collection.objects: obj.select_set(True)
bpy.context.view_layer.objects.active=roots[0]
bpy.ops.export_scene.gltf(filepath=str(OUT/'furniture.glb'),export_format='GLB',use_selection=True,export_extras=True,export_cameras=False,export_lights=False,export_apply=True,export_yup=True)
(OUT/'manifest.json').write_text(json.dumps({'version':1,'generator':'Blender MCP 1.9.1 / Blender '+bpy.app.version_string,'license':'Original project assets','models':manifest},indent=2)+'\n')
print(json.dumps({'models':len(roots),'bytes':(OUT/'furniture.glb').stat().st_size,'output':str(OUT)},indent=2))
