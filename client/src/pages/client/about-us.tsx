import { useQuery } from "@tanstack/react-query";
import { Building2, Image } from "lucide-react";

export default function ClientAboutUs() {
  const { data, isLoading } = useQuery<any>({
    queryKey: ['/api/about-us'],
  });

  if (isLoading) return (
    <div className="flex items-center justify-center h-64">
      <div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full" />
    </div>
  );

  const imgSrc = data?.imageBase64
    ? `data:${data.imageType || 'image/png'};base64,${data.imageBase64}`
    : null;

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
          <Building2 className="w-5 h-5 text-primary" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-foreground">Quem Somos Nós</h1>
          <p className="text-sm text-muted-foreground">Conheça a VivaFrutaz</p>
        </div>
      </div>

      {/* Card */}
      <div className="bg-card rounded-2xl border border-border/50 premium-shadow overflow-hidden">
        {/* Image banner */}
        <div className="relative h-48 bg-gradient-to-br from-primary/10 to-primary/5 flex items-center justify-center overflow-hidden">
          {imgSrc ? (
            <img src={imgSrc} alt="Imagem institucional" className="h-full w-full object-cover" />
          ) : (
            <div className="flex flex-col items-center gap-2 text-muted-foreground">
              <Image className="w-10 h-10 opacity-40" />
              <span className="text-sm">VivaFrutaz</span>
            </div>
          )}
        </div>

        <div className="p-8 space-y-8">
          {/* Title */}
          <h2 className="text-3xl font-bold text-foreground">
            {data?.title || 'Quem Somos Nós'}
          </h2>

          {/* Founding Year */}
          {data?.foundingYear && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="bg-primary/5 rounded-xl p-4 border border-primary/10">
                <p className="text-xs font-bold text-primary/70 uppercase tracking-wider mb-1">Ano de Fundação</p>
                <p className="text-2xl font-bold text-primary">{data.foundingYear}</p>
              </div>
            </div>
          )}

          {/* Main Content */}
          {data?.content && (
            <div>
              <p className="text-muted-foreground leading-relaxed whitespace-pre-wrap text-base">
                {data.content}
              </p>
            </div>
          )}

          {/* Mission / Vision / Values */}
          {(data?.mission || data?.vision || data?.values) && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {data?.mission && (
                <div className="bg-muted/30 rounded-xl p-5 border border-border/50 space-y-2">
                  <p className="text-sm font-bold text-foreground flex items-center gap-2">
                    🎯 Missão
                  </p>
                  <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-wrap">
                    {data.mission}
                  </p>
                </div>
              )}
              {data?.vision && (
                <div className="bg-muted/30 rounded-xl p-5 border border-border/50 space-y-2">
                  <p className="text-sm font-bold text-foreground flex items-center gap-2">
                    🔭 Visão
                  </p>
                  <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-wrap">
                    {data.vision}
                  </p>
                </div>
              )}
              {data?.values && (
                <div className="bg-muted/30 rounded-xl p-5 border border-border/50 space-y-2">
                  <p className="text-sm font-bold text-foreground flex items-center gap-2">
                    💎 Valores
                  </p>
                  <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-wrap">
                    {data.values}
                  </p>
                </div>
              )}
            </div>
          )}

          {!data?.content && !data?.mission && !data?.vision && !data?.values && (
            <div className="py-12 text-center text-muted-foreground">
              <Building2 className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p>Informações institucionais ainda não cadastradas.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
