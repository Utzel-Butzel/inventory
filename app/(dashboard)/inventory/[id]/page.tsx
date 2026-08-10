import { ResourceEditor } from "@/components/resource-editor";

type Props = { params: Promise<{ id: string }> };

export default async function InventoryItemPage({ params }: Props) {
  const { id } = await params;
  return <ResourceEditor resourceId={id} />;
}
