import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export default function NotFound() {
  return (
    <div className="min-h-dvh flex items-center justify-center p-6">
      <Card className="max-w-md w-full text-center py-10 space-y-4">
        <p className="text-4xl font-bold gradient-text tnum">404</p>
        <p className="text-text-dim">页面不存在</p>
        <Link href="/">
          <Button>回到总览</Button>
        </Link>
      </Card>
    </div>
  );
}
