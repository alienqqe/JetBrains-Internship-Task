/* eslint-disable no-magic-numbers */
/* eslint-disable no-console */
import React, { memo, useCallback, useEffect, useState } from 'react'
import Toggle from '@jetbrains/ring-ui-built/components/toggle/toggle'

// Register widget in YouTrack. To learn more, see https://www.jetbrains.com/help/youtrack/devportal-apps/apps-host-api.html
const host = await YTApp.register()

interface Project {
  id: string
  name: string
  flag: boolean
}
interface ProjectCustomField {
  field: {
    name: string
    id: string
  }
  id: string
  emptyFieldText: string
}
interface GlobalCustomField {
  id: string
  name: string
}

const AppComponent: React.FunctionComponent = () => {
  const [flagValues, setFlagValues] = useState<Project[]>([])
  const [projects, setProjects] = useState<Project[]>([])

  const getCustomFields = async () => {
    try {
      // fetch the list of all customFields
      const listOfCustomFields: GlobalCustomField[] = await host.fetchYouTrack(
        'admin/customFieldSettings/customFields?fields=id,name,fieldType(presentation,id)',
        {
          method: 'GET',
        }
      )

      return listOfCustomFields
    } catch (e) {
      console.error(e)
      return []
    }
  }

  const getProjectCustomFields = async (projectId: string) => {
    try {
      // fetch customFields attached to project
      const projectFields: ProjectCustomField[] = await host.fetchYouTrack(
        `admin/projects/${projectId}/customFields?fields=id,canBeEmpty,emptyFieldText,project(id,name),field(id,name)`,
        {
          method: 'GET',
        }
      )

      return projectFields
    } catch (e) {
      console.error("Error while fetching project's custom fields", e)
      return []
    }
  }

  const attachFieldToProjects = async (
    customField: GlobalCustomField,
    projectList: Project[]
  ) => {
    await Promise.all(
      projectList.map(async (project) => {
        try {
          const projectFields = await getProjectCustomFields(project.id)
          // get the field
          const flagField = projectFields.find(
            (field: ProjectCustomField) => field.field.name === 'Flag'
          )

          if (flagField) {
            return
          }

          // send request to attach field to the project
          await host.fetchYouTrack(
            `admin/projects/${project.id}/customFields`,
            {
              method: 'POST',
              body: {
                field: {
                  id: customField.id,
                  name: 'Flag',
                },

                $type: 'SimpleProjectCustomField',
              },
              headers: { 'Content-Type': 'application/json' },
            }
          )

          await new Promise((res) => setTimeout(res, 2000)) // Wait 2 sec
          await getCustomFields()
        } catch (e) {
          console.error(`Failed to attach custom field to ${project.id}:`, e)
        }
      })
    )
  }

  // function to create customField on the backend and attach it to the projects
  const createCustomField = useCallback(async (projectList: Project[]) => {
    try {
      let listOfCustomFields = await getCustomFields()

      let customField = listOfCustomFields.find(
        (field: GlobalCustomField) => field.name === 'Flag'
      )

      if (!customField) {
        // create the field
        customField = await host.fetchYouTrack(
          `admin/customFieldSettings/customFields?fields=id,bundle(id,isUpdateable,name,values(archived,releaseDate,released,id,name)),canBeEmpty,emptyFieldText,field(name,aliases,id,isAutoAttached,isDisplayedInIssueList,isPublic,isUpdateable),project(id,name)`,
          {
            method: 'POST',
            body: {
              name: 'Flag',
              fieldType: {
                id: 'text',
              },
              emptyFieldText: 'false',
              isAutoAttached: false,
              isPublic: true,
            },
          }
        )
      }

      // Ensure we get the latest list of fields
      await new Promise((res) => setTimeout(res, 2000)) // Small delay for backend sync
      listOfCustomFields = await getCustomFields()
      customField = listOfCustomFields.find(
        (field: GlobalCustomField) => field.name === 'Flag'
      )

      if (!customField) {
        console.error('Failed to create custom field.')
        return
      }

      // attach custom field to every project
      await attachFieldToProjects(customField, projectList)
    } catch (error) {
      console.error('Error creating global custom field:', error)
    }
  }, [])

  const fetchFlagValue = async (projectId: string) => {
    try {
      const projectFields: ProjectCustomField[] = await host.fetchYouTrack(
        `admin/projects/${projectId}/customFields?fields=id,canBeEmpty,emptyFieldText,project(id,name),field(id,name),value(name)`,
        { method: 'GET' }
      )

      // find the flag field
      const flagField = projectFields.find(
        (field) => field.field.name === 'Flag'
      )

      if (!flagField) {
        return null
      }

      return flagField?.emptyFieldText === 'true' // Convert to boolean
    } catch (error) {
      console.error(`Error fetching flag value for ${projectId}:`, error)
      return null
    }
  }

  // fetch projects and set their flag values
  const fetchProjects = useCallback(async () => {
    const res: Project[] = await host.fetchYouTrack(
      `admin/projects?fields=id,name,type`,
      { method: 'GET' }
    )

    setProjects(res)

    const fetchedFlagValues = await Promise.all(
      res.map(async (project) => ({
        id: project.id,
        name: project.name,
        flag: (await fetchFlagValue(project.id)) ?? false, // Ensure default value
      }))
    )
    setFlagValues(fetchedFlagValues)
  }, [])

  // change the flag value
  const updateFlag = async (projectId: string, newFlag: boolean) => {
    try {
      let flagField: ProjectCustomField | undefined
      let retries = 5

      while (retries > 0) {
        const projectFields = await getProjectCustomFields(projectId)

        flagField = projectFields.find((field) => field.field.name === 'Flag')
        if (flagField) {
          break
        }

        console.warn(`Flag field not found, retrying...)`)
        retries--
        await new Promise((res) => setTimeout(res, 1000)) // Wait 1 second before retrying
      }
      if (!flagField) {
        console.error('Flag field is not found after 5 retries')
        return
      }

      // change the flag value on the backend
      await host.fetchYouTrack(
        `admin/projects/${projectId}/customFields/${flagField.id}`,
        {
          method: 'POST',
          body: {
            emptyFieldText: `${newFlag.toString()}`, // NOTE: I recognize, that saving value in the emptyFieldText is not the best idea, but i couldn't find a better solution in the docs
          },
          headers: { 'Content-Type': 'application/json' },
        }
      )

      // also update flagValues
      setFlagValues((prevFlags) =>
        prevFlags.map((p) => (p.id === projectId ? { ...p, flag: newFlag } : p))
      )
    } catch (e) {
      console.error(e)
    }
  }
  useEffect(() => {
    const initialize = async () => {
      await fetchProjects() // Fetch projects first
    }
    initialize()
  }, [])

  useEffect(() => {
    const setupFieldAndRefresh = async () => {
      if (projects.length > 0) {
        await createCustomField(projects) // Ensure the field is created
        await fetchProjects() // Refresh projects AFTER ensuring field exists
      }
    }
    setupFieldAndRefresh()
  }, [projects])

  return (
    <div className='widget'>
      {projects.map((item, idx) => (
        <div key={item.id} className='projects-div'>
          {flagValues[idx] ? (
            <>
              <h1>{item.name}</h1>
              <h1>{`Flag is: ${flagValues[idx].flag}`}</h1>
              <Toggle
                key={item.id}
                checked={flagValues[idx].flag}
                onClick={() =>
                  updateFlag(flagValues[idx].id, !flagValues[idx].flag)
                }
              />
            </>
          ) : (
            <h1>Loading...</h1>
          )}
        </div>
      ))}
    </div>
  )
}

export const App = memo(AppComponent)
