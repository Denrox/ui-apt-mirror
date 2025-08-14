import Title from "~/components/shared/title/title";
import classNames from "classnames";
import type { Route } from "./+types/home";
import appConfig from "~/config/config.json";
import PageLayoutFull from "~/components/shared/layout/page-layout-full";
import { useEffect, useState } from "react";
import { getHostAddress } from "~/utils/url";
import ResourceMonitor from "~/components/shared/resource-monitor/resource-monitor";
import { useLoaderData, useActionData, useSubmit, useRevalidator } from "react-router";
import { loader, type RepositoryConfig, type CommentedSection } from "./loader";
import { action } from "./actions";
import Modal from "~/components/shared/modal/modal";
import FormButton from "~/components/shared/form/form-button";
import Dropdown from "~/components/shared/dropdown/dropdown";
import DropdownItem from "~/components/shared/dropdown/dropdown-item";
import { toast } from "react-toastify";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Apt Mirror Main Page" },
    { name: "description", content: "Apt Mirror Main Page" },
  ];
}

export { loader, action };

export default function Home() {
  const [timer, setTimer] = useState<NodeJS.Timeout | null>(null);
  const [pagesAvalabilityState, setPagesAvalabilityState] = useState<{ [key: string]: boolean }>({});
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string>("");
  const { repositoryConfigs, commentedSections, isLockFilePresent } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const submit = useSubmit();
  const revalidator = useRevalidator();

  useEffect(() => {
    if (actionData?.success) {
      revalidator.revalidate();
      setShowDeleteModal(false);
      setDeleteTarget("");
      if (actionData.message) {
        toast.success(actionData.message);
      }
    } else if (actionData && 'error' in actionData) {
      toast.error(actionData.error);
    }
  }, [actionData, revalidator]);

  const handleDeleteClick = (sectionTitle: string) => {
    setDeleteTarget(sectionTitle);
    setShowDeleteModal(true);
  };

  const handleDeleteConfirm = () => {
    const formData = new FormData();
    formData.append("action", "deleteRepository");
    formData.append("sectionTitle", deleteTarget);
    submit(formData, { method: "post" });
  };

  const handleDeleteCancel = () => {
    setShowDeleteModal(false);
    setDeleteTarget("");
  };

  const handleRestoreClick = (sectionTitle: string) => {
    const formData = new FormData();
    formData.append("action", "restoreRepository");
    formData.append("sectionTitle", sectionTitle);
    submit(formData, { method: "post" });
  };

  const handleSyncToggle = () => {
    const formData = new FormData();
    formData.append("action", isLockFilePresent ? "stopSync" : "startSync");
    submit(formData, { method: "post" });
  };

  useEffect(() => {
    const checkPagesAvalability = async () => {
      const pages = appConfig.hosts;
      const pagesAvalabilityState = await Promise.all(pages.map(async (page) => {
        try {
          const response = await fetch(getHostAddress(page.address));
          return { [getHostAddress(page.address)]: response.ok };
        } catch (error) {
          return { [getHostAddress(page.address)]: false };
        }
      }));
      setPagesAvalabilityState(pagesAvalabilityState.reduce((acc, curr) => ({ ...acc, ...curr }), {}));
    };
    
    checkPagesAvalability();
    
    if (timer) {
      clearInterval(timer);
    }
    const interval = setInterval(checkPagesAvalability, 10000);
    setTimer(interval);

    return () => {
      if (timer) {
        clearInterval(timer);
      }
    };
  }, []);

  // Auto-refresh sync status every 5 seconds
  useEffect(() => {
    const syncStatusInterval = setInterval(() => {
      revalidator.revalidate();
    }, 5000);

    return () => {
      clearInterval(syncStatusInterval);
    };
  }, [revalidator]);

  return (
    <PageLayoutFull>
      <div className="relative mb-4">
        <div className="flex items-center justify-center gap-3">
          <Title title="Repository Configuration" action={(
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-2">
                <div className={`flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ${
                  isLockFilePresent 
                    ? 'bg-blue-100 text-blue-700 border border-blue-200' 
                    : 'bg-gray-100 text-gray-600 border border-gray-200'
                }`}>
                  <span 
                    className={`${isLockFilePresent ? 'animate-spin' : ''} cursor-pointer hover:opacity-80 transition-opacity`} 
                    onClick={handleSyncToggle}
                    title={isLockFilePresent ? "Click to stop sync" : "Click to start sync"}
                  >
                    {isLockFilePresent ? '🔄' : '⏸️'}
                  </span>
                  <span>{isLockFilePresent ? 'Syncing' : 'Idle'}</span>
                </div>
              </div>
              <Dropdown
                trigger={
                  <FormButton onClick={() => {}} type="primary" size="small">
                    +
                  </FormButton>
                }
                disabled={commentedSections.length === 0 || isLockFilePresent}
              >
                {commentedSections.map((section: CommentedSection, index: number) => (
                  <DropdownItem
                    key={index}
                    onClick={() => handleRestoreClick(section.title)}
                  >
                    Restore: {section.title}
                  </DropdownItem>
                ))}
              </Dropdown>
            </div>
          )} />
        </div>
      </div>
      <div className="flex flex-row items-center md:gap-[32px] gap-[12px] flex-wrap px-[12px] md:px-0">
        {repositoryConfigs.length > 0 ? (
          repositoryConfigs.map((config: RepositoryConfig, index: number) => (
            <div key={index} className="md:w-[calc(50%-18px)] w-full h-[148px] overflow-y-auto relative bg-gray-100 border border-gray-200 shadow-md rounded-md flex flex-col gap-[12px] p-[12px]">
              <div className="block text-[16px] flex-shrink-0 w-[calc(100%-48px)] whitespace-nowrap overflow-hidden text-ellipsis text-blue-500 font-semibold">
                {config.title}
              </div>
              {config.content.map((line: string, lineIndex: number) => (
                <div key={lineIndex} className="text-[12px] text-gray-500">
                  {line}
                </div>
              ))}
              <button
                onClick={() => handleDeleteClick(config.title)}
                className="absolute top-[12px] right-[12px] text-red-500 hover:text-red-700 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                title={isLockFilePresent ? "Cannot delete while sync is running" : "Delete repository configuration"}
                disabled={isLockFilePresent}
              >
                🗑️
              </button>
            </div>
          ))
        ) : (
          <div className="w-full h-[148px] bg-gray-50 border-2 border-dashed border-gray-300 rounded-md flex flex-col items-center justify-center p-[12px]">
            <div className="text-gray-400 text-[48px] mb-2">📦</div>
            <div className="text-gray-500 text-[14px] font-medium text-center">
              No repository configurations found
            </div>
            <div className="text-gray-400 text-[12px] text-center mt-1">
              Use the + button to restore commented configurations
            </div>
          </div>
        )}
      </div>

      {/* Delete Confirmation Modal */}
      <Modal
        isOpen={showDeleteModal}
        onClose={handleDeleteCancel}
        title="Confirm Deletion"
      >
        <p className="text-gray-600 mb-6">
          Are you sure you want to delete the repository configuration "{deleteTarget}"? This action cannot be undone.
        </p>
        <div className="flex justify-end gap-3">
          <FormButton onClick={handleDeleteCancel} type="secondary">
            Cancel
          </FormButton>
          <FormButton onClick={handleDeleteConfirm} type="danger">
            Delete
          </FormButton>
        </div>
      </Modal>

      <Title title="Services Status" />
      <div className="px-[12px] md:px-0">
        <ResourceMonitor />
      </div>
      <div className="flex flex-row items-center md:gap-[32px] gap-[12px] flex-wrap px-[12px] md:px-0">
        {appConfig.hosts.map((page) => (
          <div key={page.address} className={classNames("h-[120px] md:w-[calc(50%-18px)] w-full lg:w-[calc(33%-17px)] relative bg-gray-100 border border-gray-200 shadow-md rounded-md flex flex-col gap-[12px] p-[12px]", {
          })}>
            <a href={getHostAddress(page.address)} target="_blank" rel="noopener noreferrer" className={classNames("block text-[16px] w-[calc(100%-48px)] whitespace-nowrap overflow-hidden text-ellipsis text-blue-500 font-semibold", {
            })}>{`${page.name} (${getHostAddress(page.address)})`}</a>
            <div className="text-[12px] text-gray-500">
              {page.description}
            </div>
            <div className="absolute top-[12px] right-[12px] leading-none">
              {pagesAvalabilityState[getHostAddress(page.address)] ? <div className="font-semibold leading-[24px] text-[9px] text-green-500">Online</div> : <div className="font-semibold leading-[24px] text-[12px] text-red-500">Offline</div>}
            </div>
          </div>
        ))}
      </div>
    </PageLayoutFull>
  );
}
