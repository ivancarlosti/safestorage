import CompareSlider from '@/components/CompareSlider';

export default async function PublicAlbumPage({
	params
}: {
	readonly params: Promise<{ file1: string; file2: string }>;
}) {
	const { file1, file2 } = await params;

	return (
		<>
			<div className="w-full flex h-full flex-grow flex-col">
				<CompareSlider file1={file1} file2={file2} />
			</div>
		</>
	);
}
